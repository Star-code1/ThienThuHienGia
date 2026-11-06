/**
 * Hệ thống gọi AI đa nhà cung cấp với cơ chế tự động chuyển vùng khi hết Token/Lỗi & Tối ưu tốc độ (Fast Speed):
 * 1. Gemini 2.5 Flash (GEMINI_API_KEY)
 * 2. Cerebras (CEREBRAS_API_KEY)
 * 3. Groq (GROQ_API_KEY)
 * 4. Cloudflare Workers AI (CLOUDFLARE_API_TOKEN)
 * 5. Chutes AI (CHUTES_API_KEY)
 * 6. DeepSeek V3 (DEEPSEEK_API_KEY)
 * 7. OpenRouter (OPENROUTER_API_KEY)
 */
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
const REQUEST_TIMEOUT_MS = 15000;

// Model reasoning ("nghĩ ngầm" trước khi trả JSON) hay ăn hết token budget rồi trả về
// rỗng nếu maxTokens quá thấp -> cần cấp thêm buffer riêng cho nhóm này.
const REASONING_MODEL_HINTS = ['r1', 'reasoning', 'qwq', 'thinking'];
function isReasoningModel(model) {
    const m = model.toLowerCase();
    return REASONING_MODEL_HINTS.some(hint => m.includes(hint));
}

/**
 * Trích JSON hợp lệ ra khỏi phần text trả về của model, kể cả khi model:
 * - Bọc trong ```json ... ``` hoặc ``` ... ```
 * - Thêm lời dẫn/giải thích trước hoặc sau khối JSON
 * - Chèn reasoning trace phía trước (<think>...</think> hoặc tương tự)
 */
function extractJsonObject(rawText) {
    if (!rawText) throw new Error('Nội dung rỗng, không có gì để parse JSON');

    if (typeof rawText === 'object' && rawText !== null) {
        return rawText;
    }

    let text = typeof rawText === 'string' ? rawText.trim() : String(rawText).trim();

    // Loại bỏ khối reasoning kiểu <think>...</think> nếu có
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Nếu thẻ <think> dở dang (không có </think>), tìm xem có { sau nó không
    if (text.includes('<think>')) {
        const thinkIdx = text.indexOf('<think>');
        const firstBrace = text.indexOf('{', thinkIdx);
        if (firstBrace !== -1) {
            text = text.slice(firstBrace);
        } else {
            throw new Error('Mô hình đang suy nghĩ dở trong <think> và chưa sinh JSON');
        }
    }

    // Loại bỏ code fence ```json ... ``` hoặc ``` ... ```
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
        text = fenceMatch[1].trim();
    }

    // Nếu vẫn còn text thừa quanh JSON, cắt từ dấu { đầu tiên đến } cuối cùng
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        text = text.slice(firstBrace, lastBrace + 1);
    } else if (firstBrace !== -1 && (lastBrace === -1 || lastBrace < firstBrace)) {
        // Có { mở nhưng chưa có } đóng (bị cắt ngắn giữa chừng do hết maxTokens)
        text = text.slice(firstBrace);
        if ((text.match(/"/g) || []).length % 2 === 1) {
            text += '"';
        }
        text += '\n}';
    }

    try {
        return JSON.parse(text);
    } catch (primaryErr) {
        // Thử clean các lỗi cú pháp JSON phổ biến
        let cleaned = text
            .replace(/,\s*([}\]])/g, '$1') // Xóa trailing comma
            .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, '"$1":') // Chuyển single-quoted key thành double-quoted
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":'); // Chuyển unquoted key thành double-quoted

        try {
            return JSON.parse(cleaned);
        } catch (secondaryErr) {
            throw primaryErr;
        }
    }
}

/**
 * fetch có timeout để tránh 1 provider "treo" kéo dài toàn bộ pipeline fallback
 */
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Gọi API OpenAI-compatible với cơ chế Retry Exponential Backoff & Lọc Mã Lỗi
 */
async function fetchOpenAICompatibleWithRetry({ url, key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature, extraHeaders = {} }) {
    let lastErr = null;
    const effectiveMaxTokens = jsonMode && isReasoningModel(model) ? Math.max(maxTokens, 800) : maxTokens;

    for (let retry = 0; retry < 2; retry++) {
        try {
            const body = {
                model,
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    { role: 'user', content: userPrompt }
                ],
                temperature,
                max_tokens: effectiveMaxTokens,
                ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
            };

            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    ...extraHeaders
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const textErr = await res.text();
                const status = res.status;
                const err = new Error(`Status ${status}: ${textErr}`);
                err.status = status;

                if (RETRYABLE_STATUSES.includes(status) && retry < 1) {
                    await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
                    continue;
                }
                throw err;
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content;
            if (text && text.trim()) return text.trim();
            throw new Error('Nội dung trả về rỗng');
        } catch (e) {
            lastErr = e;
            if (e.name === 'AbortError') {
                lastErr = new Error(`Timeout sau ${REQUEST_TIMEOUT_MS}ms`);
                if (retry < 1) continue;
                break;
            }
            if (e.status && !RETRYABLE_STATUSES.includes(e.status)) {
                break;
            }
        }
    }
    throw lastErr;
}

/**
 * Gọi API Gemini với cơ chế Retry Exponential Backoff & Lọc Mã Lỗi
 */
async function fetchGeminiWithRetry({ key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature }) {
    let lastErr = null;

    for (let retry = 0; retry < 2; retry++) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const body = {
                ...(systemPrompt ? {
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    }
                } : {}),
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: userPrompt }]
                    }
                ],
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens,
                    ...(jsonMode ? { responseMimeType: 'application/json' } : {})
                }
            };

            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const textErr = await res.text();
                const status = res.status;
                const err = new Error(`Status ${status}: ${textErr}`);
                err.status = status;

                if (RETRYABLE_STATUSES.includes(status) && retry < 1) {
                    await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
                    continue;
                }
                throw err;
            }

            const data = await res.json();
            const candidate = data.candidates?.[0];
            // Gemini có thể trả về finishReason: 'MAX_TOKENS' với parts rỗng khi bị cắt giữa chừng
            const text = candidate?.content?.parts?.[0]?.text;
            if (text && text.trim()) return text.trim();
            throw new Error(`Gemini trả về nội dung rỗng (finishReason: ${candidate?.finishReason || 'unknown'})`);
        } catch (e) {
            lastErr = e;
            if (e.name === 'AbortError') {
                lastErr = new Error(`Timeout sau ${REQUEST_TIMEOUT_MS}ms`);
                if (retry < 1) continue;
                break;
            }
            if (e.status && !RETRYABLE_STATUSES.includes(e.status)) {
                break;
            }
        }
    }
    throw lastErr;
}

/**
 * Gọi API Cloudflare Workers AI với cơ chế Retry Exponential Backoff & Lọc Mã Lỗi
 */
async function fetchCloudflareWithRetry({ key, accountId, model, systemPrompt, userPrompt, maxTokens, temperature }) {
    let lastErr = null;

    for (let retry = 0; retry < 2; retry++) {
        try {
            const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
            const body = {
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: maxTokens,
                temperature
            };

            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const textErr = await res.text();
                const status = res.status;
                const err = new Error(`Status ${status}: ${textErr}`);
                err.status = status;

                if (RETRYABLE_STATUSES.includes(status) && retry < 1) {
                    await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
                    continue;
                }
                throw err;
            }

            const data = await res.json();
            let text = data.result?.response ?? data.result?.choices?.[0]?.message?.content;
            if (typeof text === 'object' && text !== null) {
                text = JSON.stringify(text);
            }
            if (typeof text === 'string' && text.trim()) return text.trim();
            throw new Error('Cloudflare Workers AI trả về nội dung rỗng');
        } catch (e) {
            lastErr = e;
            if (e.name === 'AbortError') {
                lastErr = new Error(`Timeout sau ${REQUEST_TIMEOUT_MS}ms`);
                if (retry < 1) continue;
                break;
            }
            if (e.status && !RETRYABLE_STATUSES.includes(e.status)) {
                break;
            }
        }
    }
    throw lastErr;
}

/**
 * Hệ thống gọi AI đa nhà cung cấp tối ưu 2026 với cơ chế Fallback Pipeline & Retry Exponential Backoff
 */
async function callMultiProviderAI({ systemPrompt = '', userPrompt, jsonMode = false, maxTokens = 250, temperature = 0.3 }) {
    const providers = [
        {
            name: 'Gemini',
            key: process.env.GEMINI_API_KEY,
            models: [
                'gemini-3.5-flash-lite',
                'gemini-3.8-flash'
            ],
            callModel: async (model, key) => fetchGeminiWithRetry({ key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature })
        },
        {
            name: 'Groq',
            key: process.env.GROQ_API_KEY,
            models: [
                'qwen/qwen3.8-27b',
                'openai/gpt-oss-120b',
                'openai/gpt-oss-20b'
            ],
            callModel: async (model, key) => fetchOpenAICompatibleWithRetry({
                url: 'https://api.groq.com/openai/v1/chat/completions',
                key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature
            })
        },
        {
            name: 'Cloudflare Workers AI',
            key: process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN,
            models: [
                '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
                '@cf/meta/llama-3.1-8b-instruct',
                '@cf/mistral/mistral-7b-instruct-v0.2'
            ],
            callModel: async (model, key) => {
                const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
                if (!accountId) throw new Error('Chưa cấu hình CLOUDFLARE_ACCOUNT_ID trong .env');
                return fetchCloudflareWithRetry({ key, accountId, model, systemPrompt, userPrompt, maxTokens, temperature });
            }
        },
        {
            name: 'OpenRouter',
            key: process.env.OPENROUTER_API_KEY,
            models: [
                'google/gemma-4-31b-it:free',
                'google/gemma-4-26b-a4b-it:free',
                'nvidia/nemotron-3-super-120b-a12b:free'
            ],
            callModel: async (model, key) => fetchOpenAICompatibleWithRetry({
                url: 'https://openrouter.ai/api/v1/chat/completions',
                key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature,
                extraHeaders: {
                    'HTTP-Referer': 'https://discordbot.org',
                    'X-Title': 'ThienThuHienGia_DiscordBot'
                }
            })
        },
        {
            name: 'Cerebras',
            key: process.env.CEREBRAS_API_KEY,
            models: ['gpt-oss-120b', 'qwen-3.8-27b'],
            callModel: async (model, key) => fetchOpenAICompatibleWithRetry({
                url: 'https://api.cerebras.ai/v1/chat/completions',
                key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature
            })
        },
        {
            name: 'DeepSeek V3',
            key: process.env.DEEPSEEK_API_KEY,
            models: ['deepseek-chat'],
            callModel: async (model, key) => fetchOpenAICompatibleWithRetry({
                url: 'https://api.deepseek.com/chat/completions',
                key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature
            })
        },
        {
            name: 'Chutes AI',
            key: process.env.CHUTES_API_KEY,
            models: ['deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct'],
            callModel: async (model, key) => fetchOpenAICompatibleWithRetry({
                url: 'https://chutes-api.chutes.ai/v1/chat/completions',
                key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature
            })
        }
    ];

    const errorLog = [];

    for (const provider of providers) {
        if (!provider.key) continue;

        for (const modelName of provider.models) {
            try {
                const result = await provider.callModel(modelName, provider.key);
                if (result && result.trim()) return result.trim();
            } catch (err) {
                errorLog.push(`${provider.name} -> ${modelName}: ${err.message}`);
                console.warn(`⚠️ [${provider.name} -> ${modelName}] gặp lỗi: ${err.message}. Đang chuyển tiếp...`);
            }
        }
    }

    const aggregateErr = new Error('Tất cả AI Providers đều chưa cấu hình key hoặc không thể đáp ứng.');
    aggregateErr.details = errorLog;
    throw aggregateErr;
}

/**
 * Gọi callMultiProviderAI ở jsonMode và tự động parse + tự retry 1 lần với
 * prompt "ép JSON nghiêm ngặt hơn" nếu lần đầu parse thất bại (model trả JSON
 * lỗi định dạng khá thường xuyên, nhất là các model free-tier nhỏ).
 */
async function callMultiProviderAIJson(options) {
    const rawFirst = await callMultiProviderAI({ ...options, jsonMode: true });
    try {
        return extractJsonObject(rawFirst);
    } catch (parseErr) {
        console.warn(`⚠️ Parse JSON lần 1 thất bại (${parseErr.message}), thử lại với prompt siết chặt hơn...`);
        const strictPrompt = `${options.userPrompt}\n\nCHỈ trả về đúng một đối tượng JSON hợp lệ, không thêm bất kỳ ký tự, lời dẫn, hay code fence nào khác.`;
        const rawSecond = await callMultiProviderAI({
            ...options,
            userPrompt: strictPrompt,
            jsonMode: true,
            maxTokens: Math.max(options.maxTokens || 250, 400)
        });
        return extractJsonObject(rawSecond);
    }
}

module.exports = {
    callMultiProviderAI,
    callMultiProviderAIJson,
    extractJsonObject,
    isReasoningModel,
};
