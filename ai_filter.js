require('dotenv').config();
const { Ollama } = require('ollama');

// config
const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434';
const CHECK_INTERVAL_MS = 30000; 
const COOLDOWN_MS = 60000; 
const MAX_BAD_RESPONSES = 5;

const ollama = new Ollama({ host: OLLAMA_URL });

// state
let isAiHealthy = false; 
let badResponseCount = 0;
let isOnCooldown = false;
let statusChangeCallback = null;

// status handler
function handleStatusChange(newStatus) {
    if (isAiHealthy !== newStatus) {
        isAiHealthy = newStatus;
        if (statusChangeCallback) statusChangeCallback(isAiHealthy);
    }
}

// health check
async function startHealthCheck() {
    if (process.env.USE_LOCAL_AI !== 'true') return;

    // startup check
    try {
        await ollama.list();
        handleStatusChange(true);
        console.log('ai service connected');
    } catch (e) {
        console.error('ai service unreachable at startup');
        handleStatusChange(false);
    }

    // loop
    setInterval(async () => {
        if (isOnCooldown) return; 

        try {
            await ollama.list();
            if (!isAiHealthy) console.log('ai service back online');
            handleStatusChange(true);
        } catch (e) {
            if (isAiHealthy) console.error('ai service lost connection');
            handleStatusChange(false);
        }
    }, CHECK_INTERVAL_MS);
}

// cooldown
function triggerCooldown() {
    if (isOnCooldown) return;
    
    console.warn(`ai disabling for ${COOLDOWN_MS/1000}s`);
    handleStatusChange(false);
    isOnCooldown = true;

    setTimeout(() => {
        isOnCooldown = false;
        badResponseCount = 0;
        console.log('ai cooldown over');
    }, COOLDOWN_MS);
}

async function checkTicketSafety(inputString) {
    const startTime = Date.now(); 

    if (process.env.USE_LOCAL_AI !== 'true' || !isAiHealthy) {
        return { is_unsafe: false, skipped: true };
    }

    if (!inputString || typeof inputString !== 'string') {
        return { is_unsafe: false };
    }

    const validResponses = [];
    const targetCount = 3;
    let attempts = 0;
    const maxAttempts = 6; 

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
                badResponseCount++;
                if (badResponseCount >= MAX_BAD_RESPONSES) {
                    triggerCooldown();
                    return { is_unsafe: false, skipped: true }; 
                }
            }
        } catch (e) {
            console.error('ai request error', e);
            handleStatusChange(false); 
            return { is_unsafe: false, skipped: true };
        }
    }

    if (validResponses.length === 0) return { is_unsafe: false };

    const yesCount = validResponses.filter(r => r === 'Yes').length;
    const noCount = validResponses.filter(r => r === 'No').length;
    const isUnsafe = yesCount > noCount;

    // log
    const duration = Date.now() - startTime;
    console.log(`ai decision: ${isUnsafe ? 'UNSAFE' : 'SAFE'} | time: ${duration}ms`);

    if (badResponseCount > 0) badResponseCount--; 

    return {
        is_unsafe: isUnsafe,
        votes: { yes: yesCount, no: noCount }
    };
}

startHealthCheck();

module.exports = { 
    checkTicketSafety, 
    getAiStatus: () => isAiHealthy && process.env.USE_LOCAL_AI === 'true',
    setAiStatusCallback: (cb) => { statusChangeCallback = cb; }
};