import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_KEY || ''
);

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL_ONE;
const DEMO_CREDITS = 100000;

const MODEL_COSTS = {
    'xiaomi/mimo-v2-flash:free': 300,
    'mistralai/devstral-2512:free': 100,
    'z-ai/glm-4.5-air:free': 100,
    'openai/gpt-oss-120b:free': 50
};

const rateMap = new Map();
const reqMap = new Map();

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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    
    const ip = req.headers['x-forwarded-for'] || 'unknown';
    if (!ddosOk(ip)) return res.status(429).json({ error: 'Too many requests' });
    
    try {
        const { action, userId, email, displayName, photoURL, username, prompt, model, cost, files, projects, projectName } = req.body;
        
        if (action === 'init_user') {
            if (!userId || !email) return res.status(400).json({ error: 'Missing data' });
            
            let { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            
            if (!user) {
                const { data: newUser, error: createError } = await supabase
                    .from('users')
                    .insert({
                        id: userId,
                        email: email,
                        display_name: displayName,
                        photo_url: photoURL,
                        username: email.split('@')[0] + Math.floor(Math.random() * 1000),
                        credits: DEMO_CREDITS
                    })
                    .select()
                    .single();
                user = newUser;
            }

            const { data: projects } = await supabase
                .from('projects')
                .select('*')
                .eq('author_id', userId);

            return res.json({
                success: true,
                credits: user.credits,
                username: user.username,
                projects: projects || []
            });
        }
        
        if (action === 'save_projects') {
            if (!userId || !projects) return res.status(400).json({ error: 'Missing data' });
            
            for (const p of projects) {
                await supabase.from('projects').upsert({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    visibility: p.visibility,
                    slug: p.slug,
                    files: p.files,
                    versions: p.versions,
                    comments: p.comments,
                    preview: p.preview?.substring(0, 100000),
                    author_id: userId,
                    author_username: p.authorUsername,
                    author_photo: p.authorPhoto,
                    created_at: p.createdAt,
                    updated_at: p.updatedAt
                }, { onConflict: 'id' });
            }
            
            return res.json({ success: true });
        }
        
        if (action === 'update_username') {
            if (!userId || !username) return res.status(400).json({ error: 'Missing data' });
            
            const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
            
            const { data: taken } = await supabase
                .from('users')
                .select('id')
                .eq('username', clean)
                .neq('id', userId)
                .single();
            
            if (taken) return res.status(400).json({ error: 'Username taken' });
            
            await supabase.from('users').update({ username: clean }).eq('id', userId);
            
            return res.json({ success: true, username: clean });
        }
        
        if (action === 'generate') {
            if (!userId || !prompt || !model) return res.status(400).json({ error: 'Missing data' });
            if (!rateOk(userId)) return res.status(429).json({ error: 'Wait before generating again' });
            
            const actualCost = MODEL_COSTS[model];
            if (!actualCost) return res.status(400).json({ error: 'Invalid model' });
            
            const { data: user } = await supabase
                .from('users')
                .select('credits, is_generating')
                .eq('id', userId)
                .single();
            
            if (!user) return res.status(404).json({ error: 'User not found' });
            if (user.is_generating) return res.status(429).json({ error: 'Generation in progress' });
            if (user.credits < actualCost) return res.status(400).json({ error: 'Not enough credits' });
            
            await supabase.from('users').update({ is_generating: true }).eq('id', userId);
            
            try {
                const filesCtx = files?.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n') || '';
                
                const sysPrompt = `You are DroidGen, an expert code generator. You ONLY output code.

Rules:
- Output code in markdown blocks with filename comment
- Format: \`\`\`html\n// index.html\n<code>\n\`\`\`
- Make complete, working code
- Use modern best practices
- No explanations, only code blocks`;

                const userPrompt = filesCtx 
                    ? `Current files:\n\n${filesCtx}\n\nRequest: ${prompt.substring(0, 5000)}`
                    : `Create: ${prompt.substring(0, 5000)}`;
                
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
                    throw new Error(err.error?.message || 'API error');
                }
                
                const data = await response.json();
                const output = data.choices[0]?.message?.content || '';
                const parsed = parseBlocks(output);
                
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
            if (!target) return res.status(404).json({ error: 'User not found' });
            
            await supabase.from('users').update({ credits: target.credits + amt }).eq('id', target.id);
            
            return res.json({ success: true });
        }
        
        return res.status(400).json({ error: 'Unknown action' });
        
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message || 'Server error' });
    }
}

function parseBlocks(output) {
    const files = [];
    const regex = /
