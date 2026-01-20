import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_EMAIL_ONE = process.env.ADMIN_EMAIL_ONE;
const DEMO_CREDITS = 100000;

const rateLimitMap = new Map();
const requestCounts = new Map();

const MODEL_COSTS = {
    'xiaomi/mimo-v2-flash:free': 300,
    'mistralai/devstral-2512:free': 100,
    'z-ai/glm-4.5-air:free': 100,
    'openai/gpt-oss-120b:free': 50
};

function rateLimit(userId) {
    const now = Date.now();
    const userLimit = rateLimitMap.get(userId);
    
    if (userLimit && now - userLimit < 2000) {
        return false;
    }
    
    rateLimitMap.set(userId, now);
    return true;
}

function checkDDoS(ip) {
    const now = Date.now();
    const windowMs = 60000;
    const maxRequests = 30;
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
    }
    
    const requests = requestCounts.get(ip).filter(t => now - t < windowMs);
    requests.push(now);
    requestCounts.set(ip, requests);
    
    return requests.length <= maxRequests;
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/[<>]/g, '')
        .slice(0, 10000);
}

function validateUserId(userId) {
    return typeof userId === 'string' && 
           userId.length > 0 && 
           userId.length < 128 &&
           /^[a-zA-Z0-9_-]+$/.test(userId);
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    
    if (!checkDDoS(ip)) {
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    
    try {
        const { action, userId, email, prompt, model, cost, files, versions, adminId, targetEmail, credits } = req.body;
        
        if (!action) {
            return res.status(400).json({ error: 'Missing action' });
        }
        
        if (action === 'init_user') {
            if (!validateUserId(userId) || !email) {
                return res.status(400).json({ error: 'Invalid user data' });
            }
            
            let { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            
            if (error && error.code === 'PGRST116') {
                const { data: newUser, error: insertError } = await supabase
                    .from('users')
                    .insert({
                        id: userId,
                        email: email,
                        credits: DEMO_CREDITS,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();
                
                if (insertError) {
                    console.error('Insert error:', insertError);
                    return res.status(500).json({ error: 'Failed to create user' });
                }
                
                user = newUser;
            } else if (error) {
                console.error('Query error:', error);
                return res.status(500).json({ error: 'Database error' });
            }
            
            const { data: versionsData } = await supabase
                .from('versions')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            
            const { data: filesData } = await supabase
                .from('files')
                .select('*')
                .eq('user_id', userId);
            
            const isAdmin = email === ADMIN_EMAIL_ONE;
            
            return res.status(200).json({
                success: true,
                credits: user.credits,
                isAdmin,
                versions: versionsData || [],
                files: filesData || []
            });
        }
        
        if (action === 'generate') {
            if (!validateUserId(userId)) {
                return res.status(400).json({ error: 'Invalid user ID' });
            }
            
            if (!rateLimit(userId)) {
                return res.status(429).json({ error: 'Please wait before making another request' });
            }
            
            const sanitizedPrompt = sanitizeInput(prompt);
            if (!sanitizedPrompt) {
                return res.status(400).json({ error: 'Invalid prompt' });
            }
            
            if (!MODEL_COSTS[model]) {
                return res.status(400).json({ error: 'Invalid model' });
            }
            
            const actualCost = MODEL_COSTS[model];
            
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('credits, is_generating')
                .eq('id', userId)
                .single();
            
            if (userError || !user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            if (user.is_generating) {
                return res.status(429).json({ error: 'You already have a request in progress' });
            }
            
            if (user.credits < actualCost) {
                return res.status(400).json({ error: 'Insufficient credits' });
            }
            
            await supabase
                .from('users')
                .update({ is_generating: true })
                .eq('id', userId);
            
            try {
                let messages = [
                    {
                        role: 'system',
                        content: 'You are a helpful AI assistant specialized in coding and creative tasks. Provide clear, well-structured responses.'
                    },
                    {
                        role: 'user',
                        content: sanitizedPrompt
                    }
                ];
                
                if (files && files.length > 0) {
                    const fileDescriptions = files.map(f => `[Attached file: ${f.name} (${f.type})]`).join('\n');
                    messages[1].content = `${fileDescriptions}\n\n${sanitizedPrompt}`;
                    
                    const imageFiles = files.filter(f => f.type.startsWith('image/'));
                    if (imageFiles.length > 0) {
                        messages[1] = {
                            role: 'user',
                            content: [
                                { type: 'text', text: sanitizedPrompt },
                                ...imageFiles.map(f => ({
                                    type: 'image_url',
                                    image_url: { url: f.dataUrl }
                                }))
                            ]
                        };
                    }
                }
                
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://droidgen.vercel.app',
                        'X-Title': 'Droidgen AI'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: messages,
                        max_tokens: 4096,
                        temperature: 0.7
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error?.message || 'API request failed');
                }
                
                const data = await response.json();
                const output = data.choices[0]?.message?.content || 'No response generated';
                
                const newCredits = user.credits - actualCost;
                
                await supabase
                    .from('users')
                    .update({ 
                        credits: newCredits,
                        is_generating: false 
                    })
                    .eq('id', userId);
                
                await supabase
                    .from('versions')
                    .insert({
                        user_id: userId,
                        prompt: sanitizedPrompt.substring(0, 500),
                        output: output.substring(0, 50000),
                        model: model,
                        created_at: new Date().toISOString(),
                        pinned: false
                    });
                
                return res.status(200).json({
                    success: true,
                    output,
                    credits: newCredits
                });
                
            } catch (apiError) {
                await supabase
                    .from('users')
                    .update({ is_generating: false })
                    .eq('id', userId);
                
                console.error('API Error:', apiError);
                return res.status(500).json({ error: apiError.message });
            }
        }
        
        if (action === 'update_versions') {
            if (!validateUserId(userId)) {
                return res.status(400).json({ error: 'Invalid user ID' });
            }
            
            await supabase
                .from('versions')
                .delete()
                .eq('user_id', userId);
            
            if (versions && versions.length > 0) {
                const versionRecords = versions.map(v => ({
                    user_id: userId,
                    prompt: v.prompt?.substring(0, 500) || '',
                    output: v.output?.substring(0, 50000) || '',
                    model: v.model || '',
                    created_at: v.createdAt || new Date().toISOString(),
                    pinned: v.pinned || false
                }));
                
                await supabase
                    .from('versions')
                    .insert(versionRecords);
            }
            
            return res.status(200).json({ success: true });
        }
        
        if (action === 'update_files') {
            if (!validateUserId(userId)) {
                return res.status(400).json({ error: 'Invalid user ID' });
            }
            
            await supabase
                .from('files')
                .delete()
                .eq('user_id', userId);
            
            if (files && files.length > 0) {
                const fileRecords = files.map(f => ({
                    user_id: userId,
                    name: f.name?.substring(0, 255) || 'unnamed',
                    type: f.type || 'application/octet-stream',
                    size: f.size || 0
                }));
                
                await supabase
                    .from('files')
                    .insert(fileRecords);
            }
            
            return res.status(200).json({ success: true });
        }
        
        if (action === 'admin_give_credits') {
            if (!validateUserId(adminId)) {
                return res.status(400).json({ error: 'Invalid admin ID' });
            }
            
            const { data: adminUser } = await supabase
                .from('users')
                .select('email')
                .eq('id', adminId)
                .single();
            
            if (!adminUser || adminUser.email !== ADMIN_EMAIL_ONE) {
                return res.status(403).json({ error: 'Unauthorized: Admin access required' });
            }
            
            if (!targetEmail || typeof credits !== 'number' || credits <= 0 || credits > 10000000) {
                return res.status(400).json({ error: 'Invalid email or credits amount' });
            }
            
            const { data: targetUser, error: targetError } = await supabase
                .from('users')
                .select('id, credits')
                .eq('email', targetEmail)
                .single();
            
            if (targetError || !targetUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            const { error: updateError } = await supabase
                .from('users')
                .update({ credits: targetUser.credits + credits })
                .eq('id', targetUser.id);
            
            if (updateError) {
                return res.status(500).json({ error: 'Failed to update credits' });
            }
            
            return res.status(200).json({ success: true });
        }
        
        return res.status(400).json({ error: 'Unknown action' });
        
    } catch (error) {
        console.error('Handler error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
