require('dotenv').config();
const { Ollama } = require('ollama');

// config
const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434';
const CHECK_INTERVAL_MS = 30000; // check health every 30s
const COOLDOWN_MS = 60000; // disable for 1m if too many bad responses
const MAX_BAD_RESPONSES = 5;

const ollama = new Ollama({ host: OLLAMA_URL });

// state
let isAiHealthy = false; // assumes false until first ping
let badResponseCount = 0;
let isOnCooldown = false;

// periodic health check (ping)
async function startHealthCheck() {
    if (process.env.USE_LOCAL_AI !== 'true') return;

    setInterval(async () => {
        if (isOnCooldown) return; // skip if cooling down

        try {
            // simple list request to check connectivity
            await ollama.list();
            if (!isAiHealthy) console.log('AI Service is back online');
            isAiHealthy = true;
        } catch (e) {
            if (isAiHealthy) console.error('AI Service lost connection');
            isAiHealthy = false;
        }
    }, CHECK_INTERVAL_MS);

    // initial check
    try {
        await ollama.list();
        isAiHealthy = true;
        console.log('AI Service connected');
    } catch (e) {
        console.error('AI Service unreachable at startup');
    }
}

// cooldown logic
function triggerCooldown() {
    if (isOnCooldown) return;
    
    console.warn(`AI triggering too many invalid responses. Disabling for ${COOLDOWN_MS/1000}s.`);
    isAiHealthy = false;
    isOnCooldown = true;

    setTimeout(() => {
        isOnCooldown = false;
        badResponseCount = 0;
        // let the next interval check re-enable health
        console.log('AI Cooldown over. Waiting for health check...');
    }, COOLDOWN_MS);
}

async function checkTicketSafety(inputString) {
    // fast exit if disabled or offline
    if (process.env.USE_LOCAL_AI !== 'true' || !isAiHealthy) {
        return { is_unsafe: false, skipped: true };
    }

    if (!inputString || typeof inputString !== 'string') {
        return { is_unsafe: false };
    }

    const validResponses = [];
    const targetCount = 3;
    let attempts = 0;
    const maxAttempts = 6; // avoid infinite loops locally

    while (validResponses.length < targetCount && attempts < maxAttempts) {
        attempts++;
        try {
            const response = await ollama.chat({
                model: 'granite3-guardian:8b',
                messages: [{ role: 'user', content: inputString }],
            });

            const rawContent = response.message.content.trim();

            if (rawContent === 'Yes' || rawContent === 'No') {
                validResponses.push(rawContent);
            } else {
                // invalid format logic
                badResponseCount++;
                if (badResponseCount >= MAX_BAD_RESPONSES) {
                    triggerCooldown();
                    return { is_unsafe: false, skipped: true }; // fail open (allow user)
                }
            }
        } catch (e) {
            console.error('ai request error', e);
            // if network error, mark unhealthy immediately
            isAiHealthy = false; 
            return { is_unsafe: false, skipped: true };
        }
    }

    // if we couldn't get 3 valid votes in time
    if (validResponses.length === 0) return { is_unsafe: false };

    const yesCount = validResponses.filter(r => r === 'Yes').length;
    const noCount = validResponses.filter(r => r === 'No').length;

    // reset bad counter on success
    if (badResponseCount > 0) badResponseCount--; 

    return {
        is_unsafe: yesCount > noCount,
        votes: { yes: yesCount, no: noCount }
    };
}

// start monitoring immediately
startHealthCheck();

module.exports = { 
    checkTicketSafety, 
    getAiStatus: () => isAiHealthy && process.env.USE_LOCAL_AI === 'true'
};