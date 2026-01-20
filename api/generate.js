import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL_ONE;
const DEMO_CREDITS = 100000;

const MODEL_COSTS = {
    'xiaomi/mimo-v2-flash:free': 300,
    'mistralai/devstral-2512:free': 100,
    'z-ai/glm-4.5-air:free': 100,
    'openai/gpt-oss-120b:free': 50
};

const rateLimits = new Map();
const requestCounts = new Map();

function rateLimit(userId) {
    const now = Date.now();
    const last = rateLimits.get(userId);
    if (last && now - last < 3000) return false;
    rateLimits.set(userId, now);
    return true;
}

function checkDDoS(ip) {
    const now = Date.now();
    const window = 60000;
    const max = 60;
    
    let requests = requestCounts.get(ip) || [];
    requests = requests.filter(t => now - t < window);
    requests.push(now);
    requestCounts.set(ip, requests);
    
    return requests.length <= max;
}

function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.slice(0, 50000);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const ip = req.headers['x-forwarded-for'] || 'unknown';
    if (!checkDDoS(ip)) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    
    try {
        const { action, userId, email, displayName, photoURL, username, prompt, model, cost, files, projects, projectName } = req.body;
        
        if (action === 'init_user') {
            if (!userId || !email) {
                return res.status(400).json({ error: 'Missing user data' });
            }
            
            let user;
            const { data: existingUser } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            
            if (!existingUser) {
                const { data: newUser, error } = await supabase
                    .from('users')
                    .insert({
                        id: userId,
                        email,
                        display_name: displayName,
                        photo_url: photoURL,
                        username: userId.substring(0, 8),
                        credits: DEMO_CREDITS,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();
                
                if (error) {
                    console.error('Insert error:', error);
                    return res.json({ success: true, credits: DEMO_CREDITS, username: userId.substring(0, 8), projects: [] });
                }
                user = newUser;
            } else {
                user = existingUser;
            }
            
            const { data: userProjects } = await supabase
                .from('projects')
                .select('*')
                .eq('author_id', userId)
                .order('updated_at', { ascending: false });
            
            return res.json({
                success: true,
                credits: user.credits,
                username: user.username,
                isAdmin: email === ADMIN_EMAIL,
                projects: userProjects || []
            });
        }
        
        if (action === 'get_public_projects') {
            const { data: publicProjects } = await supabase
                .from('projects')
                .select('*')
                .eq('visibility', 'public')
                .order('updated_at', { ascending: false })
                .limit(50);
            
            return res.json({ projects: publicProjects || [] });
        }
        
        if (action === 'save_projects') {
            if (!userId || !projects) {
                return res.status(400).json({ error: 'Missing data' });
            }
            
            for (const project of projects) {
                const projectData = {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    visibility: project.visibility,
                    slug: project.slug,
                    files: project.files,
                    versions: project.versions,
                    comments: project.comments,
                    preview: project.preview?.substring(0, 100000),
                    author_id: userId,
                    author_username: project.authorUsername,
                    author_photo: project.authorPhoto,
                    created_at: project.createdAt,
                    updated_at: project.updatedAt
                };
                
                await supabase
                    .from('projects')
                    .upsert(projectData, { onConflict: 'id' });
            }
            
            return res.json({ success: true });
        }
        
        if (action === 'update_username') {
            if (!userId || !username) {
                return res.status(400).json({ error: 'Missing data' });
            }
            
            const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
            
            const { data: existing } = await supabase
                .from('users')
                .select('id')
                .eq('username', cleanUsername)
                .neq('id', userId)
                .single();
            
            if (existing) {
                return res.status(400).json({ error: 'Username taken' });
            }
            
            await supabase
                .from('users')
                .update({ username: cleanUsername })
                .eq('id', userId);
            
            return res.json({ success: true, username: cleanUsername });
        }
        
        if (action === 'generate') {
            if (!userId || !prompt || !model) {
                return res.status(400).json({ error: 'Missing data' });
            }
            
            if (!rateLimit(userId)) {
                return res.status(429).json({ error: 'Please wait before generating again' });
            }
            
            const actualCost = MODEL_COSTS[model];
            if (!actualCost) {
                return res.status(400).json({ error: 'Invalid model' });
            }
            
            const { data: user } = await supabase
                .from('users')
                .select('credits, is_generating')
                .eq('id', userId)
                .single();
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            if (user.is_generating) {
                return res.status(429).json({ error: 'Generation already in progress' });
            }
            
            if (user.credits < actualCost) {
                return res.status(400).json({ error: 'Insufficient credits' });
            }
            
            await supabase
                .from('users')
                .update({ is_generating: true })
                .eq('id', userId);
            
            try {
                const filesContext = files?.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n') || '';
                
                const systemPrompt = `You are an expert code generator for DroidGen. You ONLY generate code, nothing else.

When the user asks you to create or modify something:
1. Analyze the existing files if provided
2. Generate clean, working code
3. Output code in markdown code blocks with the filename as a comment on the first line

Format your response EXACTLY like this:
\`\`\`html
// index.html
<!DOCTYPE html>
...
\`\`\`

\`\`\`css
// style.css
...
\`\`\`

\`\`\`javascript
// script.js
...
\`\`\`

Rules:
- Only output code blocks, no explanations
- Always include the filename comment
- Make sure code is complete and functional
- Use modern best practices
- If modifying existing code, include the full updated file`;

                const userPrompt = filesContext 
                    ? `Current project files:\n\n${filesContext}\n\nUser request: ${sanitize(prompt)}`
                    : `Create a new project: ${sanitize(prompt)}`;
                
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://droidgen.vercel.app',
                        'X-Title': 'DroidGen'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        max_tokens: 8000,
                        temperature: 0.7
                    })
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error?.message || 'API error');
                }
                
                const data = await response.json();
                const output = data.choices[0]?.message?.content || '';
                
                const parsedFiles = parseCodeBlocks(output);
                
                const newCredits = user.credits - actualCost;
                await supabase
                    .from('users')
                    .update({ credits: newCredits, is_generating: false })
                    .eq('id', userId);
                
                return res.json({
                    success: true,
                    output: output,
                    files: parsedFiles,
                    credits: newCredits
                });
                
            } catch (error) {
                await supabase
                    .from('users')
                    .update({ is_generating: false })
                    .eq('id', userId);
                
                console.error('Generation error:', error);
                return res.status(500).json({ error: error.message });
            }
        }
        
        if (action === 'admin_give_credits') {
            const { adminId, targetEmail, credits: creditsToGive } = req.body;
            
            const { data: admin } = await supabase
                .from('users')
                .select('email')
                .eq('id', adminId)
                .single();
            
            if (!admin || admin.email !== ADMIN_EMAIL) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            
            const { data: target } = await supabase
                .from('users')
                .select('id, credits')
                .eq('email', targetEmail)
                .single();
            
            if (!target) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            await supabase
                .from('users')
                .update({ credits: target.credits + creditsToGive })
                .eq('id', target.id);
            
            return res.json({ success: true });
        }
        
        return res.status(400).json({ error: 'Unknown action' });
        
    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
}

function parseCodeBlocks(output) {
    const files = [];
    const regex = /```(\w+)?\n(?:\/\/\s*)?(\S+\.\w+)?\n?([\s\S]*?)```/g;
    let match;
    
    while ((match = regex.exec(output)) !== null) {
        const lang = match[1] || '';
        let filename = match[2];
        let content = match[3]?.trim() || '';
        
        const firstLineMatch = content.match(/^\/\/\s*(\S+\.\w+)\s*\n/);
        if (firstLineMatch) {
            filename = firstLineMatch[1];
            content = content.replace(/^\/\/\s*\S+\.\w+\s*\n/, '');
        }
        
        if (!filename) {
            if (lang === 'html') filename = 'index.html';
            else if (lang === 'css') filename = 'style.css';
            else if (lang === 'javascript' || lang === 'js') filename = 'script.js';
            else continue;
        }
        
        files.push({ name: filename, content });
    }
    
    return files;
}
