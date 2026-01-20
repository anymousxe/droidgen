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

function parseBlocks(output) {
    const files = [];
    const regex = /
