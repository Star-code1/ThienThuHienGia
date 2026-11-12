/**
 * Hệ thống gọi AI đa nhà cung cấp với fallback pool miễn phí
 * (xem free-chat-llm-api-fallback-pool.md — Gemini + OpenRouter :free).
 * - Thứ tự ưu tiên xen kẽ Gemini / OpenRouter để không dồn hết vào 1 quota.
 * - 429: cooldown (Retry-After hoặc tới 0h UTC nếu hết quota ngày); OpenRouter dùng chung
 *   quota tài khoản nên 429 sẽ bỏ qua toàn bộ model OpenRouter còn lại.
 * - 401/403: tạm khóa provider, cần kiểm tra key. 5xx/timeout: retry 1 lần rồi chuyển.
 * Key cần trong .env: GEMINI_API_KEY, OPENROUTER_API_KEY (tuỳ chọn: CLOUDFLARE_*, CEREBRAS_API_KEY).
 */
const RETRYABLE_STATUSES = [500, 502, 503, 504];
const REQUEST_TIMEOUT_MS = 20000;
const RETRY_BACKOFF_MS = 1000;

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

function parseRetryAfterMs(res) {
    const header = res.headers?.get?.('retry-after');
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * POST JSON với retry ngắn: chỉ retry 1 lần cho lỗi 5xx / timeout / network.
 * 429 KHÔNG retry tại chỗ (request lỗi vẫn bị tính quota) -> để pool xử lý cooldown.
 */
async function postJsonWithRetry({ url, headers, body, extractText }) {
    let lastErr = null;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const textErr = await res.text().catch(() => '');
                const err = new Error(`Status ${res.status}: ${textErr.slice(0, 500)}`);
                err.status = res.status;
                err.body = textErr;
                err.retryAfterMs = parseRetryAfterMs(res);
                throw err;
            }

            const data = await res.json();
            const text = extractText(data);
            if (typeof text === 'string' && text.trim()) return text.trim();
            const emptyErr = new Error('Nội dung trả về rỗng');
            emptyErr.isEmpty = true;
            throw emptyErr;
        } catch (e) {
            lastErr = e;
            if (e.name === 'AbortError') {
                lastErr = new Error(`Timeout sau ${REQUEST_TIMEOUT_MS}ms`);
                lastErr.isTimeout = true;
            }
            const transient = lastErr.isTimeout || RETRYABLE_STATUSES.includes(lastErr.status) || (!lastErr.status && !lastErr.isEmpty);
            if (transient && attempt === 0) {
                await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
                continue;
            }
            break;
        }
    }
    throw lastErr;
}

function buildMessages(systemPrompt, userPrompt) {
    return [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
    ];
}

function callOpenAICompatible({ url, key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature, extraHeaders = {} }) {
    const effectiveMaxTokens = jsonMode && isReasoningModel(model) ? Math.max(maxTokens, 800) : maxTokens;
    return postJsonWithRetry({
        url,
        headers: { 'Authorization': `Bearer ${key}`, ...extraHeaders },
        body: {
            model,
            messages: buildMessages(systemPrompt, userPrompt),
            temperature,
            max_tokens: effectiveMaxTokens,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
        },
        extractText: data => data.choices?.[0]?.message?.content
    });
}

function callGemini({ key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature }) {
    return postJsonWithRetry({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body: {
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens,
                ...(jsonMode ? { responseMimeType: 'application/json' } : {})
            }
        },
        // Gemini có thể trả finishReason MAX_TOKENS với parts rỗng; bỏ qua part "thought" nếu có
        extractText: data => (data.candidates?.[0]?.content?.parts || [])
            .filter(p => !p.thought && typeof p.text === 'string')
            .map(p => p.text)
            .join('')
    });
}

function callCloudflare({ key, accountId, model, systemPrompt, userPrompt, maxTokens, temperature }) {
    return postJsonWithRetry({
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        headers: { 'Authorization': `Bearer ${key}` },
        body: { messages: buildMessages(systemPrompt, userPrompt), max_tokens: maxTokens, temperature },
        extractText: data => {
            const text = data.result?.response ?? data.result?.choices?.[0]?.message?.content;
            return typeof text === 'object' && text !== null ? JSON.stringify(text) : text;
        }
    });
}

// ---------------------------------------------------------------------------
// Fallback pool (theo free-chat-llm-api-fallback-pool.md, kiểm tra 12/11/2026)
// ---------------------------------------------------------------------------

/**
 * Provider định nghĩa cách gọi + phạm vi quota:
 * - cooldownScope 'model'    : quota tính theo từng model (Gemini: theo project + model)
 * - cooldownScope 'provider' : quota chung cả tài khoản (OpenRouter: 20 RPM / 50 RPD cho mọi model :free)
 */
const PROVIDERS = {
    gemini: {
        name: 'Gemini',
        envKey: () => process.env.GEMINI_API_KEY,
        cooldownScope: 'model',
        call: (model, key, opts) => callGemini({ key, model, ...opts })
    },
    openrouter: {
        name: 'OpenRouter',
        envKey: () => process.env.OPENROUTER_API_KEY,
        cooldownScope: 'provider',
        call: (model, key, opts) => callOpenAICompatible({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            key, model, ...opts,
            extraHeaders: {
                'HTTP-Referer': 'https://discordbot.org',
                'X-Title': 'ThienThuHienGia_DiscordBot'
            }
        })
    },
    // Dự phòng cuối (free tier riêng, không nằm trong tài liệu pool)
    cloudflare: {
        name: 'Cloudflare Workers AI',
        envKey: () => process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN,
        cooldownScope: 'provider',
        call: (model, key, opts) => {
            const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
            if (!accountId) throw new Error('Chưa cấu hình CLOUDFLARE_ACCOUNT_ID trong .env');
            return callCloudflare({ key, accountId, model, ...opts });
        }
    },
    cerebras: {
        name: 'Cerebras',
        envKey: () => process.env.CEREBRAS_API_KEY,
        cooldownScope: 'provider',
        call: (model, key, opts) => callOpenAICompatible({
            url: 'https://api.cerebras.ai/v1/chat/completions',
            key, model, ...opts
        })
    }
};

// Thứ tự: model chat tổng quát mạnh nhất -> yếu nhất (model chuyên coding xếp sau
// vì kém hợp chat). Chỉ dùng model miễn phí: Groq / SambaNova / DeepSeek / Chutes bị loại.
const FALLBACK_POOL = [
    ['gemini', 'gemini-3.8-flash'],
    ['openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'],
    ['gemini', 'gemini-3-flash-preview'],
    ['openrouter', 'baidu/ernie-5.5-flash-preview:free'],
    ['openrouter', 'thinkingmachines/inkling-2-small:free'],
    ['openrouter', 'nvidia/nemotron-3.5-super-vl:free'],
    ['openrouter', 'qwen/qwen3.8-27b:free'],
    ['openrouter', 'dots-studio/dots-3-note-preview:free'],
    ['gemini', 'gemini-3.1-flash-lite'],
    ['openrouter', 'google/gemma-4-26b-a4b-it:free'],
    ['cerebras', 'gpt-oss-120b'],
    ['openrouter', 'poolside/laguna-s-2.1:free'],
    ['openrouter', 'cohere/north-mini-code:free'],
    ['openrouter', 'recursive/flint-v1.0:free'],
    ['openrouter', 'nvidia/nemotron-3.5-lightning:free'],
    ['cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
    ['openrouter', 'nvidia/nemotron-3-nano-omni:free'],
    ['openrouter', 'poolside/laguna-xs-2.1:free'],
    ['cloudflare', '@cf/meta/llama-3.1-8b-instruct'],
    ['openrouter', 'liquid/lfm-3-1.7b:free'],
].map(([provider, model]) => ({ provider, model }));

// Giới hạn số request thực sự gửi đi trong 1 lượt gọi (không retry vô hạn)
const MAX_ATTEMPTS_PER_CALL = 8;

const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const AUTH_ERROR_COOLDOWN_MS = 30 * 60 * 1000;
const MODEL_NOT_FOUND_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_TRANSIENT_COOLDOWN_MS = 10 * 60 * 1000;

// key -> { until, reason }
const cooldowns = new Map();

function cooldownKey(providerId, model) {
    return model ? `${providerId}::${model}` : providerId;
}

function getCooldown(providerId, model) {
    const now = Date.now();
    for (const key of [cooldownKey(providerId), cooldownKey(providerId, model)]) {
        const entry = cooldowns.get(key);
        if (!entry) continue;
        if (entry.until > now) return entry;
        cooldowns.delete(key);
    }
    return null;
}

function setCooldown(providerId, model, ms, reason) {
    const until = Date.now() + ms;
    const key = cooldownKey(providerId, model);
    const prev = cooldowns.get(key);
    if (!prev || prev.until < until) cooldowns.set(key, { until, reason });
    const scope = model ? `${providerId} -> ${model}` : providerId;
    console.warn(`⏸️ [AI cooldown] ${scope} tạm nghỉ đến ${new Date(until).toISOString()} (${reason})`);
}

function msUntilNextUtcMidnight() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return next - now.getTime();
}

function isDailyQuotaError(err) {
    const text = (err.body || err.message || '').toLowerCase();
    return /per[-_ ]?day|daily|free-models-per-day|requests per day|rpd/.test(text);
}

/**
 * Áp quy tắc mục 4 của tài liệu cho 1 lỗi.
 * Trả về true nếu đã đặt cooldown cấp provider (=> bỏ qua các model còn lại cùng provider).
 */
function handleTargetError(target, provider, err) {
    const status = err.status;
    const modelScoped = provider.cooldownScope === 'model';
    const cdModel = modelScoped ? target.model : null;

    if (status === 429) {
        const daily = isDailyQuotaError(err);
        const ms = daily
            ? msUntilNextUtcMidnight()
            : Math.min(err.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS, 60 * 60 * 1000);
        setCooldown(target.provider, cdModel, ms, daily ? 'hết quota ngày' : '429 rate limit');
        return !modelScoped;
    }
    if (status === 401 || status === 403) {
        setCooldown(target.provider, null, AUTH_ERROR_COOLDOWN_MS, `${status} - kiểm tra API key / quyền truy cập`);
        return true;
    }
    if (status === 404) {
        setCooldown(target.provider, target.model, MODEL_NOT_FOUND_COOLDOWN_MS, '404 - model ID không tồn tại / hết free');
        return false;
    }
    if (RETRYABLE_STATUSES.includes(status) || err.isTimeout) {
        // Đã retry 1 lần trong postJsonWithRetry; nghỉ ngắn model này rồi chuyển tiếp
        setCooldown(target.provider, target.model, Math.min(RATE_LIMIT_COOLDOWN_MS, MAX_TRANSIENT_COOLDOWN_MS), err.isTimeout ? 'timeout' : `${status}`);
        return false;
    }
    // 400 (tham số không tương thích, vd response_format) / nội dung rỗng:
    // không cooldown, chỉ bỏ qua model này trong lượt gọi hiện tại.
    return false;
}

/**
 * Gọi AI theo fallback pool: giữ nguyên system prompt + nội dung khi chuyển model,
 * quản lý cooldown theo provider/model, giới hạn số lần thử mỗi lượt.
 */
async function callMultiProviderAI({ systemPrompt = '', userPrompt, jsonMode = false, maxTokens = 250, temperature = 0.3 }) {
    const opts = { systemPrompt, userPrompt, jsonMode, maxTokens, temperature };
    const errorLog = [];
    const skippedProviders = new Set();
    let attempts = 0;

    for (const target of FALLBACK_POOL) {
        if (attempts >= MAX_ATTEMPTS_PER_CALL) {
            errorLog.push(`Đã đạt giới hạn ${MAX_ATTEMPTS_PER_CALL} lần thử trong 1 lượt`);
            break;
        }

        const provider = PROVIDERS[target.provider];
        const key = provider.envKey();
        if (!key || skippedProviders.has(target.provider)) continue;
        if (getCooldown(target.provider, target.model)) continue;

        attempts++;
        try {
            const result = await provider.call(target.model, key, opts);
            if (result && result.trim()) return result.trim();
        } catch (err) {
            const line = `${provider.name} -> ${target.model}: ${err.message}`;
            errorLog.push(line);
            console.warn(`⚠️ [AI ${provider.name} -> ${target.model}] status=${err.status ?? '-'} lúc ${new Date().toISOString()}: ${err.message}. Đang chuyển tiếp...`);
            if (handleTargetError(target, provider, err)) skippedProviders.add(target.provider);
        }
    }

    const aggregateErr = new Error('Tất cả AI Providers đều chưa cấu hình key, đang cooldown hoặc không thể đáp ứng.');
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
    FALLBACK_POOL,
    _cooldowns: cooldowns,
};
