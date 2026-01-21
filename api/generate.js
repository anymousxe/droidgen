import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL_ONE;
const DEMO_CREDITS = 100000;

const MODEL_COSTS = {
    'liquid/lfm-2.5-1.2b-instruct:free': 100,
    'liquid/lfm-2.5-1.2b-thinking:free': 200,
    'z-ai/glm-4.5-air:free': 300,
    'moonshotai/kimi-k2:free': 100,
    'google/gemma-3-27b-it:free': 50,
    'z-ai/glm-4.7-flash': 800
};

const rateMap = new Map();
const reqMap = new Map();
const glm47Requests = [];

function rateOk(uid) {
    const now = Date.now();
    const last = rateMap.get(uid);
    if (last && now - last < 3000) return false;
    rateMap.set(uid, now);
    return true;
}

function ddosOk(ip) {
    const now = Date.now();
    let reqs = reqMap.get(ip) || [];
    reqs = reqs.filter(t => now - t < 60000);
    reqs.push(now);
    reqMap.set(ip, reqs);
    return reqs.length <= 60;
}

function glm47RateOk() {
    const now = Date.now();
    const recent = glm47Requests.filter(t => now - t < 60000);
    if (recent.length >= 5) return false;
    glm47Requests.length = 0;
    glm47Requests.push(...recent, now);
    return true;
}

function validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return { valid: false, error: 'Invalid prompt' };
    if (prompt.length > 10000) return { valid: false, error: 'Prompt too long (max 10,000 chars)' };
    const tokenEstimate = prompt.split(/\s+/).length;
    if (tokenEstimate > 5000) return { valid: false, error: 'Prompt has too many words' };
    const spamPatterns = [/(\d{10,})/g, /(.)\1{20,}/g];
    for (const pattern of spamPatterns) {
        if (pattern.test(prompt)) return { valid: false, error: 'Invalid prompt content' };
    }
    return { valid: true };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const ip = req.headers['x-forwarded-for'] || 'unknown';
    if (!ddosOk(ip)) return res.status(429).json({ error: 'Too many requests. Please wait.' });
    
    try {
        const { action, userId } = req.body;
        
        if (action === 'init_user') {
            const { email, displayName, photoURL } = req.body;
            if (!userId || !email) return res.status(400).json({ error: 'Missing user data' });
            
            let { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            
            let needsUsername = false;
            
            if (!user) {
                const { data: newUser, error: createError } = await supabase
                    .from('users')
                    .insert({
                        id: userId,
                        email: email,
                        display_name: displayName || '',
                        photo_url: photoURL || '',
                        username: '',
                        credits: DEMO_CREDITS,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();
                
                if (createError) {
                    console.error('Create user error:', createError);
                    return res.status(500).json({ error: 'Failed to create user' });
                }
                user = newUser;
                needsUsername = true;
            } else if (!user.username) {
                needsUsername = true;
            }

            const { data: projects } = await supabase
                .from('projects')
                .select('*')
                .eq('author_id', userId)
                .order('updated_at', { ascending: false });

            return res.json({
                success: true,
                credits: user.credits,
                username: user.username,
                displayName: user.display_name,
                photoURL: user.photo_url,
                projects: projects || [],
                needsUsername,
                isAdmin: email === ADMIN_EMAIL
            });
        }
        
        if (action === 'check_username') {
            const { username } = req.body;
            if (!username) return res.status(400).json({ error: 'Missing username' });
            
            const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
            if (clean.length < 3) return res.json({ available: false });
            
            const { data: existing } = await supabase
                .from('users')
                .select('id')
                .eq('username', clean)
                .single();
            
            return res.json({ available: !existing });
        }
        
        if (action === 'update_username') {
            const { username } = req.body;
            if (!userId || !username) return res.status(400).json({ error: 'Missing data' });
            
            const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
            if (clean.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
            
            const { data: taken } = await supabase
                .from('users')
                .select('id')
                .eq('username', clean)
                .neq('id', userId)
                .single();
            
            if (taken) return res.status(400).json({ error: 'Username already taken' });
            
            const { error } = await supabase
                .from('users')
                .update({ username: clean })
                .eq('id', userId);
            
            if (error) return res.status(500).json({ error: 'Failed to update username' });
            
            return res.json({ success: true, username: clean });
        }
        
        if (action === 'update_avatar') {
            const { avatar } = req.body;
            if (!userId || !avatar) return res.status(400).json({ error: 'Missing data' });
            
            const { error } = await supabase
                .from('users')
                .update({ photo_url: avatar })
                .eq('id', userId);
            
            if (error) return res.status(500).json({ error: 'Failed to update avatar' });
            
            return res.json({ success: true });
        }
        
        if (action === 'get_public_projects') {
            const { data: projects } = await supabase
                .from('projects')
                .select('*, users!inner(username, display_name, photo_url)')
                .eq('visibility', 'public')
                .order('created_at', { ascending: false })
                .limit(50);
            
            const formatted = (projects || []).map(p => ({
                ...p,
                author_username: p.users?.username,
                author_photo: p.users?.photo_url,
                author_display_name: p.users?.display_name
            }));
            
            return res.json({ success: true, projects: formatted });
        }
        
        if (action === 'get_my_projects') {
            if (!userId) return res.status(400).json({ error: 'Not authenticated' });
            
            const { data: projects } = await supabase
                .from('projects')
                .select('*')
                .eq('author_id', userId)
                .order('updated_at', { ascending: false });
            
            return res.json({ success: true, projects: projects || [] });
        }
        
        if (action === 'get_project') {
            const { projectId } = req.body;
            if (!projectId) return res.status(400).json({ error: 'Missing project ID' });
            
            const { data: project } = await supabase
                .from('projects')
                .select('*')
                .eq('id', projectId)
                .single();
            
            if (!project) return res.status(404).json({ error: 'Project not found' });
            
            if (project.visibility === 'private' && project.author_id !== userId) {
                return res.status(403).json({ error: 'Access denied' });
            }
            
            return res.json({ success: true, project });
        }
        
        if (action === 'save_project') {
            const { project } = req.body;
            if (!userId || !project) return res.status(400).json({ error: 'Missing data' });
            
            const { data: user } = await supabase
                .from('users')
                .select('username')
                .eq('id', userId)
                .single();
            
            let preview = '';
            const htmlFile = project.files?.find(f => f.name.endsWith('.html'));
            if (htmlFile) {
                preview = htmlFile.content?.substring(0, 50000) || '';
            }
            
            const projectData = {
                id: project.id,
                name: project.name || 'Untitled',
                description: project.description || '',
                visibility: project.visibility || 'private',
                slug: project.slug || '',
                files: project.files || [],
                versions: project.versions || [],
                preview,
                author_id: userId,
                author_username: user?.username || '',
                updated_at: new Date().toISOString()
            };
            
            const { data: existing } = await supabase
                .from('projects')
                .select('id')
                .eq('id', project.id)
                .single();
            
            if (existing) {
                await supabase.from('projects').update(projectData).eq('id', project.id);
            } else {
                projectData.created_at = new Date().toISOString();
                await supabase.from('projects').insert(projectData);
            }
            
            return res.json({ success: true });
        }
        
        if (action === 'delete_project') {
            const { projectId } = req.body;
            if (!userId || !projectId) return res.status(400).json({ error: 'Missing data' });
            
            const { data: project } = await supabase
                .from('projects')
                .select('author_id')
                .eq('id', projectId)
                .single();
            
            if (!project || project.author_id !== userId) {
                return res.status(403).json({ error: 'Access denied' });
            }
            
            await supabase.from('projects').delete().eq('id', projectId);
            await supabase.from('likes').delete().eq('project_id', projectId);
            await supabase.from('comments').delete().eq('project_id', projectId);
            
            return res.json({ success: true });
        }
        
        if (action === 'toggle_like') {
            const { projectId } = req.body;
            if (!userId || !projectId) return res.status(400).json({ error: 'Missing data' });
            
            const { data: existing } = await supabase
                .from('likes')
                .select('id')
                .eq('user_id', userId)
                .eq('project_id', projectId)
                .single();
            
            if (existing) {
                await supabase.from('likes').delete().eq('id', existing.id);
                return res.json({ success: true, liked: false });
            } else {
                await supabase.from('likes').insert({
                    user_id: userId,
                    project_id: projectId,
                    created_at: new Date().toISOString()
                });
                return res.json({ success: true, liked: true });
            }
        }
        
        if (action === 'toggle_follow') {
            const { targetUserId } = req.body;
            if (!userId || !targetUserId) return res.status(400).json({ error: 'Missing data' });
            if (userId === targetUserId) return res.status(400).json({ error: 'Cannot follow yourself' });
            
            const { data: existing } = await supabase
                .from('follows')
                .select('id')
                .eq('follower_id', userId)
                .eq('following_id', targetUserId)
                .single();
            
            if (existing) {
                await supabase.from('follows').delete().eq('id', existing.id);
                return res.json({ success: true, isFollowing: false });
            } else {
                await supabase.from('follows').insert({
                    follower_id: userId,
                    following_id: targetUserId,
                    created_at: new Date().toISOString()
                });
                return res.json({ success: true, isFollowing: true });
            }
        }
        
        if (action === 'get_profile') {
            const { profileUserId } = req.body;
            if (!profileUserId) return res.status(400).json({ error: 'Missing user ID' });
            
            const {data: profile } = await supabase
                .from('users')
                .select('*')
                .eq('id', profileUserId)
                .single();
            
            if (!profile) return res.status(404).json({ error: 'User not found' });
            
            const { count: projectsCount } = await supabase
                .from('projects')
                .select('*', { count: 'exact', head: true })
                .eq('author_id', profileUserId)
                .eq('visibility', 'public');
            
            const { count: followersCount } = await supabase
                .from('follows')
                .select('*', { count: 'exact', head: true })
                .eq('following_id', profileUserId);
            
            const { data: userProjects } = await supabase
                .from('projects')
                .select('id')
                .eq('author_id', profileUserId)
                .eq('visibility', 'public');
            
            const projectIds = (userProjects || []).map(p => p.id);
            let likesCount = 0;
            if (projectIds.length > 0) {
                const { count } = await supabase
                    .from('likes')
                    .select('*', { count: 'exact', head: true })
                    .in('project_id', projectIds);
                likesCount = count || 0;
            }
            
            let isFollowing = false;
            if (userId && userId !== profileUserId) {
                const { data: followData } = await supabase
                    .from('follows')
                    .select('id')
                    .eq('follower_id', userId)
                    .eq('following_id', profileUserId)
                    .single();
                isFollowing = !!followData;
            }
            
            const { data: projects } = await supabase
                .from('projects')
                .select('*')
                .eq('author_id', profileUserId)
                .eq('visibility', 'public')
                .order('created_at', { ascending: false })
                .limit(20);
            
            return res.json({
                success: true,
                profile: {
                    id: profile.id,
                    username: profile.username,
                    display_name: profile.display_name,
                    photo_url: profile.photo_url
                },
                projectsCount: projectsCount || 0,
                followersCount: followersCount || 0,
                likesCount,
                isFollowing,
                projects: projects || []
            });
        }
        
        if (action === 'generate') {
            const { prompt, model, cost, files } = req.body;
            if (!userId || !prompt || !model) return res.status(400).json({ error: 'Missing data' });
            
            const validation = validatePrompt(prompt);
            if (!validation.valid) return res.status(400).json({ error: validation.error });
            
            if (!rateOk(userId)) return res.status(429).json({ error: 'Please wait a few seconds before generating again' });
            
            const actualCost = MODEL_COSTS[model];
            if (!actualCost) return res.status(400).json({ error: 'Invalid model selected' });
            
            if (model === 'z-ai/glm-4.7-flash' && !glm47RateOk()) {
                return res.status(429).json({ error: 'GLM 4.7 Flash is rate limited to 5 requests per minute globally. Please try again shortly.' });
            }
            
            const { data: user } = await supabase
                .from('users')
                .select('credits, is_generating')
                .eq('id', userId)
                .single();
            
            if (!user) return res.status(404).json({ error: 'User not found' });
            if (user.is_generating) return res.status(429).json({ error: 'A generation is already in progress. Please wait.' });
            if (user.credits < actualCost) return res.status(400).json({ error: `Not enough credits. You need ${actualCost} credits.` });
            
            await supabase.from('users').update({ is_generating: true }).eq('id', userId);
            
            try {
                const filesCtx = files?.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n') || '';
                
                const sysPrompt = `You are DroidGen, an expert code generator. You ONLY output code.

Rules:
- Output code in markdown blocks with filename comment at the start
- Format: \`\`\`html
// index.html
<code here>
\`\`\`
- Create complete, working, production-ready code
- Use modern best practices and clean code
- Include all necessary HTML, CSS, and JavaScript
- Make it visually appealing with good styling
- NO explanations, NO commentary, ONLY code blocks
- If multiple files needed, output each in separate code blocks`;

                const userPrompt = filesCtx 
                    ? `Current project files:\n\n${filesCtx}\n\nUser request: ${prompt}`
                    : `Create: ${prompt}`;
                
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENROUTER_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://droidgen.vercel.app',
                        'X-Title': 'DroidGen'
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: sysPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        max_tokens: 8000,
                        temperature: 0.7
                    })
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error?.message || 'AI API error');
                }
                
                const data = await response.json();
                const output = data.choices[0]?.message?.content || '';
                const parsed = parseCodeBlocks(output);
                
                const newCredits = user.credits - actualCost;
                await supabase.from('users').update({ credits: newCredits, is_generating: false }).eq('id', userId);
                
                return res.json({ success: true, output, files: parsed, credits: newCredits });
                
            } catch (e) {
                await supabase.from('users').update({ is_generating: false }).eq('id', userId);
                throw e;
            }
        }
        
        if (action === 'admin_give_credits') {
            const { adminId, targetEmail, credits: amt } = req.body;
            
            const { data: admin } = await supabase.from('users').select('email').eq('id', adminId).single();
            if (!admin || admin.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Unauthorized' });
            
            const { data: target } = await supabase.from('users').select('id, credits').eq('email', targetEmail).single();
            if (!target) return res.status(404).json({ error: 'Target user not found' });
            
            await supabase.from('users').update({ credits: target.credits + amt }).eq('id', target.id);
            
            return res.json({ success: true });
        }
        
        return res.status(400).json({ error: 'Unknown action' });
        
    } catch (e) {
        console.error('API Error:', e);
        return res.status(500).json({ error: e.message || 'Server error' });
    }
}

function parseCodeBlocks(output) {
    const files = [];
    const regex = /```(\w+)?\n(?:\/\/\s*(\S+)\n)?([\s\S]*?)```/g;
    let match;
    
    while ((match = regex.exec(output)) !== null) {
        const lang = match[1] || 'html';
        let filename = match[2];
        const content = match[3].trim();
        
        if (!filename) {
            if (lang === 'html') filename = 'index.html';
            else if (lang === 'css') filename = 'style.css';
            else if (lang === 'javascript' || lang === 'js') filename = 'script.js';
            else filename = `file.${lang}`;
        }
        
        const existing = files.find(f => f.name === filename);
        if (existing) {
            existing.content = content;
        } else {
            files.push({ name: filename, content });
        }
    }
    
    if (files.length === 0 && output.trim()) {
        files.push({ name: 'index.html', content: output.trim() });
    }
    
    return files;
}
