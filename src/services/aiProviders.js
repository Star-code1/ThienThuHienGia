/**
 * Hệ thống gọi AI đa nhà cung cấp với fallback pool miễn phí
 * (xem free-chat-llm-api-fallback-pool.md — Gemini + OpenRouter :free).
 * - Thứ tự ưu tiên xen kẽ Gemini / OpenRouter để không dồn hết vào 1 quota.
 * - 429: cooldown (Retry-After hoặc tới 0h UTC nếu hết quota ngày); OpenRouter dùng chung
 *   quota tài khoản nên 429 sẽ bỏ qua toàn bộ model OpenRouter còn lại.
 * - 401/403: tạm khóa provider, cần kiểm tra key.
 * - 5xx/timeout: KHÔNG retry tại chỗ (model đang quá tải thường vẫn quá tải), cooldown
 *   model đó rồi chuyển ngay model kế tiếp. Chỉ retry 1 lần với lỗi mạng (ECONNRESET...).
 * - Hedging: model đang gọi chậm quá HEDGE_DELAY_MS thì gọi song song model kế tiếp,
 *   model nào trả lời trước thì dùng, các request còn lại bị hủy.
 * Key cần trong .env: GEMINI_API_KEY, OPENROUTER_API_KEY (tuỳ chọn: CLOUDFLARE_*, CEREBRAS_API_KEY).
 */
const RETRYABLE_STATUSES = [500, 502, 503, 504];
const REQUEST_TIMEOUT_MS = 15000;
const RETRY_BACKOFF_MS = 500;
// Tổng thời gian tối đa cho 1 lượt gọi qua toàn bộ pool (tránh người dùng chờ vài phút)
const DEFAULT_CALL_DEADLINE_MS = 45000;
// Còn ít hơn mức này thì không bắt đầu request mới
const MIN_ATTEMPT_TIME_MS = 3000;
// Sau bấy lâu chưa có kết quả thì gọi song song thêm model kế tiếp
const HEDGE_DELAY_MS = 4000;
const MAX_PARALLEL_REQUESTS = 2;
// Gemini tính token "suy nghĩ" vào maxOutputTokens -> cấp thêm cho model có thinking
const GEMINI_THINKING_TOKEN_BUFFER = 1024;

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
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Hủy từ bên ngoài (request hedging khác đã thắng) cũng hủy fetch này
    const onExternalAbort = () => {
        const err = new Error('Đã hủy vì model khác trả lời trước');
        err.name = 'CancelledError';
        controller.abort(err);
    };
    if (externalSignal) {
        if (externalSignal.aborted) onExternalAbort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
        if (controller.signal.reason?.name === 'CancelledError') throw controller.signal.reason;
        throw e;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onExternalAbort);
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
 * POST JSON với retry ngắn: chỉ retry 1 lần cho lỗi mạng (ECONNRESET, DNS...).
 * 429 / 5xx / timeout KHÔNG retry tại chỗ -> để pool cooldown và chuyển model khác ngay.
 */
async function postJsonWithRetry({ url, headers, body, extractText, timeoutMs = REQUEST_TIMEOUT_MS, signal = null }) {
    let lastErr = null;
    const deadline = Date.now() + timeoutMs;

    for (let attempt = 0; attempt < 2; attempt++) {
        const remaining = deadline - Date.now();
        if (attempt > 0 && remaining < MIN_ATTEMPT_TIME_MS) break;
        const attemptTimeout = Math.min(REQUEST_TIMEOUT_MS, remaining);
        try {
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(body)
            }, attemptTimeout, signal);

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
            if (e.name === 'CancelledError') throw e;
            if (e.name === 'AbortError' || e.name === 'TimeoutError') {
                lastErr = new Error(`Timeout sau ${attemptTimeout}ms`);
                lastErr.isTimeout = true;
            }
            const networkError = !lastErr.status && !lastErr.isEmpty && !lastErr.isTimeout && !(e instanceof SyntaxError);
            const timeLeftAfterBackoff = deadline - Date.now() - RETRY_BACKOFF_MS;
            if (networkError && attempt === 0 && timeLeftAfterBackoff >= MIN_ATTEMPT_TIME_MS) {
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

/**
 * reasoning (OpenRouter, theo từng model trong pool): vd { enabled: false } để model
 * reasoning không "nghĩ ngầm" ăn hết max_tokens rồi trả về rỗng.
 */
function callOpenAICompatible({ url, key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature, timeoutMs, signal, reasoning, extraHeaders = {} }) {
    const effectiveMaxTokens = jsonMode && isReasoningModel(model) ? Math.max(maxTokens, 800) : maxTokens;
    return postJsonWithRetry({
        url,
        timeoutMs,
        signal,
        headers: { 'Authorization': `Bearer ${key}`, ...extraHeaders },
        body: {
            model,
            messages: buildMessages(systemPrompt, userPrompt),
            temperature,
            max_tokens: effectiveMaxTokens,
            ...(reasoning ? { reasoning } : {}),
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
        },
        extractText: data => data.choices?.[0]?.message?.content
    });
}

// Model Gemini đã từng báo không hỗ trợ thinkingLevel được cấu hình -> lần sau bỏ qua thinkingConfig
const geminiThinkingUnsupported = new Set();

/**
 * thinkingLevel (theo từng model trong pool):
 * - 'minimal': gần như không suy nghĩ -> nhanh nhất, toàn bộ maxTokens dành cho câu trả lời
 * - 'low' ...: vẫn suy nghĩ ít -> cấp thêm GEMINI_THINKING_TOKEN_BUFFER để không bị cắt cụt
 * - undefined: để mặc định của model (model không có thinking, vd flash-lite)
 */
async function callGemini({ key, model, systemPrompt, userPrompt, jsonMode, maxTokens, temperature, timeoutMs, signal, thinkingLevel }) {
    const useThinking = thinkingLevel && !geminiThinkingUnsupported.has(model);
    const buffer = useThinking && thinkingLevel !== 'minimal' ? GEMINI_THINKING_TOKEN_BUFFER : 0;
    const startedAt = Date.now();
    const send = (withThinking, budgetMs) => postJsonWithRetry({
        timeoutMs: budgetMs,
        signal,
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: { 'x-goog-api-key': key },
        body: {
            ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
                temperature,
                maxOutputTokens: maxTokens + (withThinking ? buffer : 0),
                ...(withThinking ? { thinkingConfig: { thinkingLevel } } : {}),
                ...(jsonMode ? { responseMimeType: 'application/json' } : {})
            }
        },
        // Gemini có thể trả finishReason MAX_TOKENS với parts rỗng; bỏ qua part "thought" nếu có
        extractText: data => (data.candidates?.[0]?.content?.parts || [])
            .filter(p => !p.thought && typeof p.text === 'string')
            .map(p => p.text)
            .join('')
    });

    try {
        return await send(useThinking, timeoutMs);
    } catch (err) {
        // Model không hỗ trợ mức thinking này -> nhớ lại và gửi lại ngay không kèm thinkingConfig
        if (useThinking && err.status === 400 && /thinking/i.test(err.body || '')) {
            geminiThinkingUnsupported.add(model);
            console.warn(`⚠️ [AI Gemini -> ${model}] không hỗ trợ thinkingLevel=${thinkingLevel}, bỏ cấu hình này.`);
            const remaining = timeoutMs - (Date.now() - startedAt);
            if (remaining >= MIN_ATTEMPT_TIME_MS) return send(false, remaining);
        }
        throw err;
    }
}

function callCloudflare({ key, accountId, model, systemPrompt, userPrompt, maxTokens, temperature, timeoutMs, signal }) {
    return postJsonWithRetry({
        timeoutMs,
        signal,
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
// Tham số thứ 3 (tuỳ chọn) là cấu hình riêng của model, vd { thinkingLevel } cho Gemini.
//
// Benchmark 12/11/2026 với prompt Hiền Giả thật (~5.5k ký tự, maxTokens 500):
// - gemini-3-flash-preview (minimal) ~3.6s | ernie-5.5-flash ~3.4s | gemini-3.1-flash-lite ~3.9s
// - nemotron-3.5-super-vl: mặc định nghĩ hết token -> RỖNG; tắt reasoning còn ~1.3s
// - nemotron-3-ultra: mặc định 15s rồi RỖNG; reasoning low ~7.7s -> xếp xuống dưới vì chậm
// - gemini-3-flash-preview mặc định nghĩ ~480 token -> bị cắt cụt; gemini-3.8-flash không hỗ trợ 'minimal'
// - Đã loại: qwen/qwen3.8-27b:free (404, bị gỡ), thinkingmachines/inkling-2-small:free
//   (403 "only available on agentic harnesses")
const NO_REASONING = { reasoning: { enabled: false } };
const FALLBACK_POOL = [
    ['gemini', 'gemini-3.8-flash', { thinkingLevel: 'low' }],
    ['gemini', 'gemini-3-flash-preview', { thinkingLevel: 'minimal' }],
    ['openrouter', 'baidu/ernie-5.5-flash-preview:free'],
    ['openrouter', 'nvidia/nemotron-3.5-super-vl:free', NO_REASONING],
    ['gemini', 'gemini-3.1-flash-lite'],
    ['openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', { reasoning: { effort: 'low' } }],
    ['openrouter', 'dots-studio/dots-3-note-preview:free'],
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
].map(([provider, model, options = {}]) => ({ provider, model, options }));

// Giới hạn số request thực sự gửi đi trong 1 lượt gọi (không retry vô hạn)
const MAX_ATTEMPTS_PER_CALL = 8;

const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
// Model quá tải (503) / timeout thường kéo dài vài phút -> nghỉ lâu hơn để khỏi tốn thời gian thử lại
const OVERLOAD_COOLDOWN_MS = 5 * 60 * 1000;
const EMPTY_RESPONSE_COOLDOWN_MS = 10 * 60 * 1000;
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
    // OpenRouter trả 403 cho từng model bị hạn chế (vd "only available on agentic harnesses"),
    // key sai thì là 401 -> 403 của OpenRouter chỉ khóa model đó, không khóa cả provider.
    if (status === 403 && target.provider === 'openrouter') {
        setCooldown(target.provider, target.model, MODEL_NOT_FOUND_COOLDOWN_MS, '403 - model bị hạn chế truy cập');
        return false;
    }
    if (status === 401 || status === 403) {
        setCooldown(target.provider, null, AUTH_ERROR_COOLDOWN_MS, `${status} - kiểm tra API key / quyền truy cập`);
        return true;
    }
    if (status === 402) {
        setCooldown(target.provider, null, MODEL_NOT_FOUND_COOLDOWN_MS, '402 - hết credit / cần thanh toán');
        return true;
    }
    if (status === 404) {
        setCooldown(target.provider, target.model, MODEL_NOT_FOUND_COOLDOWN_MS, '404 - model ID không tồn tại / hết free');
        return false;
    }
    if (RETRYABLE_STATUSES.includes(status) || err.isTimeout) {
        // Không retry tại chỗ; cho model này nghỉ rồi chuyển tiếp ngay
        setCooldown(target.provider, target.model, Math.min(OVERLOAD_COOLDOWN_MS, MAX_TRANSIENT_COOLDOWN_MS), err.isTimeout ? 'timeout' : `${status}`);
        return false;
    }
    if (err.isEmpty) {
        // Trả rỗng (thường do model reasoning nghĩ hết token) -> lần sau nhiều khả năng vẫn rỗng,
        // nghỉ một lúc để không tốn thời gian chờ vô ích mỗi lượt hỏi
        setCooldown(target.provider, target.model, EMPTY_RESPONSE_COOLDOWN_MS, 'trả về rỗng');
        return false;
    }
    // 400 (tham số không tương thích, vd response_format):
    // không cooldown, chỉ bỏ qua model này trong lượt gọi hiện tại.
    return false;
}

/**
 * Gọi AI theo fallback pool: giữ nguyên system prompt + nội dung khi chuyển model,
 * quản lý cooldown theo provider/model, giới hạn số lần thử mỗi lượt.
 *
 * Hedging: lỗi -> gọi model kế tiếp ngay; model đang chạy quá hedgeDelayMs chưa xong ->
 * gọi song song thêm model kế tiếp (tối đa MAX_PARALLEL_REQUESTS). Kết quả đầu tiên
 * hợp lệ thắng, các request còn lại bị hủy.
 */
function callMultiProviderAI({
    systemPrompt = '', userPrompt, jsonMode = false, maxTokens = 250, temperature = 0.3,
    deadlineMs = DEFAULT_CALL_DEADLINE_MS, hedgeDelayMs = HEDGE_DELAY_MS
}) {
    const baseOpts = { systemPrompt, userPrompt, jsonMode, maxTokens, temperature };
    const errorLog = [];
    const skippedProviders = new Set();
    const startedAt = Date.now();
    const deadline = startedAt + deadlineMs;
    const cancel = new AbortController();
    let poolIndex = 0;
    let attempts = 0;
    let inFlight = 0;
    let settled = false;
    let hedgeTimer = null;

    return new Promise((resolve, reject) => {
        const finish = (err, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(hedgeTimer);
            cancel.abort(); // hủy các request còn đang chạy
            if (err) reject(err); else resolve(result);
        };

        const failAll = () => {
            const aggregateErr = new Error('Tất cả AI Providers đều chưa cấu hình key, đang cooldown hoặc không thể đáp ứng.');
            aggregateErr.details = errorLog;
            finish(aggregateErr);
        };

        // Lấy target kế tiếp còn dùng được trong pool (kiểm tra cooldown tại thời điểm gọi)
        const nextTarget = () => {
            while (poolIndex < FALLBACK_POOL.length) {
                const target = FALLBACK_POOL[poolIndex++];
                const provider = PROVIDERS[target.provider];
                const key = provider.envKey();
                if (!key || skippedProviders.has(target.provider)) continue;
                if (getCooldown(target.provider, target.model)) continue;
                return { target, provider, key };
            }
            return null;
        };

        const scheduleHedge = () => {
            clearTimeout(hedgeTimer);
            if (settled || inFlight === 0 || inFlight >= MAX_PARALLEL_REQUESTS) return;
            hedgeTimer = setTimeout(() => {
                if (!settled && inFlight < MAX_PARALLEL_REQUESTS) launch();
            }, hedgeDelayMs);
        };

        // Bắt đầu 1 request mới; trả về false nếu không còn gì để thử
        const launch = () => {
            if (settled) return false;
            if (attempts >= MAX_ATTEMPTS_PER_CALL) {
                errorLog.push(`Đã đạt giới hạn ${MAX_ATTEMPTS_PER_CALL} lần thử trong 1 lượt`);
                return false;
            }
            const remaining = deadline - Date.now();
            if (remaining < MIN_ATTEMPT_TIME_MS) {
                errorLog.push(`Hết thời gian ${deadlineMs}ms cho 1 lượt gọi`);
                return false;
            }
            const next = nextTarget();
            if (!next) return false;

            const { target, provider, key } = next;
            attempts++;
            inFlight++;

            Promise.resolve()
                .then(() => provider.call(target.model, key, {
                    ...baseOpts, ...target.options, timeoutMs: remaining, signal: cancel.signal
                }))
                .then(result => {
                    if (result && result.trim()) {
                        if (!settled) console.log(`✅ [AI] ${provider.name} -> ${target.model} trả lời sau ${Date.now() - startedAt}ms (lần thử ${attempts})`);
                        return finish(null, result.trim());
                    }
                    const emptyErr = new Error('Nội dung trả về rỗng');
                    emptyErr.isEmpty = true;
                    throw emptyErr;
                })
                .catch(err => {
                    if (settled || err.name === 'CancelledError') return;
                    errorLog.push(`${provider.name} -> ${target.model}: ${err.message}`);
                    console.warn(`⚠️ [AI ${provider.name} -> ${target.model}] status=${err.status ?? '-'} lúc ${new Date().toISOString()}: ${err.message}. Đang chuyển tiếp...`);
                    if (handleTargetError(target, provider, err)) skippedProviders.add(target.provider);
                })
                .finally(() => {
                    inFlight--;
                    if (settled) return;
                    // Request này lỗi -> thay ngay bằng model kế tiếp
                    if (!launch() && inFlight === 0) failAll();
                    else scheduleHedge();
                });

            scheduleHedge();
            return true;
        };

        if (!launch()) failAll();
    });
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
