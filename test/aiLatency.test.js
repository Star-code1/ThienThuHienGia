const test = require('node:test');
const assert = require('node:assert');
const { callMultiProviderAI, _cooldowns } = require('../src/services/aiProviders');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const okGemini = text => json(200, { candidates: [{ content: { parts: [{ text }] } }] });
const okOpenAI = text => json(200, { choices: [{ message: { content: text } }] });

// Request "treo" cho tới khi bị hủy
const hang = (signal, onAbort) => new Promise((_, reject) => signal.addEventListener('abort', () => {
    onAbort?.();
    reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
}));

function setup(handler) {
    _cooldowns.clear();
    const calls = [];
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CF_API_TOKEN;
    delete process.env.CEREBRAS_API_KEY;
    global.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        const model = body.model || url.match(/models\/([^:]+):/)?.[1];
        calls.push({ model, body });
        return handler(model, opts, body);
    };
    const restore = () => { global.fetch = originalFetch; process.env = originalEnv; _cooldowns.clear(); };
    return { calls, restore };
}

test('Hedging: model đầu treo thì gọi song song model kế tiếp, lấy kết quả nhanh hơn và hủy request chậm', async () => {
    let firstAborted = false;
    const { calls, restore } = setup((model, opts) => {
        if (model === 'gemini-3.8-flash') return hang(opts.signal, () => { firstAborted = true; });
        return okGemini('nhanh');
    });
    try {
        const t = Date.now();
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi', hedgeDelayMs: 100 }), 'nhanh');
        assert.ok(Date.now() - t < 2000, 'không phải chờ timeout của model đầu');
        assert.deepStrictEqual(calls.map(c => c.model), ['gemini-3.8-flash', 'gemini-3-flash-preview']);
        await new Promise(r => setImmediate(r));
        assert.ok(firstAborted, 'request chậm phải bị hủy');
        assert.strictEqual(_cooldowns.size, 0, 'request bị hủy không bị tính là lỗi');
    } finally { restore(); }
});

test('Hedging: model đầu trả lời kịp thì không gọi thêm', async () => {
    const { calls, restore } = setup(() => okGemini('ok'));
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi', hedgeDelayMs: 100 }), 'ok');
        await new Promise(r => setTimeout(r, 150));
        assert.strictEqual(calls.length, 1);
    } finally { restore(); }
});

test('503 không retry tại chỗ, chuyển ngay model kế tiếp và cooldown 5 phút', async () => {
    const { calls, restore } = setup((model) => {
        if (model === 'gemini-3.8-flash') return json(503, { error: { message: 'high demand' } });
        return okGemini('ok');
    });
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi' }), 'ok');
        assert.deepStrictEqual(calls.map(c => c.model), ['gemini-3.8-flash', 'gemini-3-flash-preview']);
        const cd = _cooldowns.get('gemini::gemini-3.8-flash');
        assert.ok(cd && cd.until - Date.now() > 4 * 60 * 1000);
    } finally { restore(); }
});

test('Gemini: gửi thinkingLevel theo pool, model không hỗ trợ thì gửi lại không kèm thinkingConfig', async () => {
    const { calls, restore } = setup((model, opts, body) => {
        if (model === 'gemini-3.8-flash' && body.generationConfig.thinkingConfig) {
            return json(400, { error: { message: 'Thinking level LOW is not supported for this model.' } });
        }
        return okGemini('ok');
    });
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi', maxTokens: 500 }), 'ok');
        assert.strictEqual(calls.length, 2);
        assert.deepStrictEqual(calls[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
        assert.strictEqual(calls[0].body.generationConfig.maxOutputTokens, 500 + 1024, 'có buffer cho token suy nghĩ');
        assert.strictEqual(calls[1].body.generationConfig.thinkingConfig, undefined);
        assert.strictEqual(calls[1].body.generationConfig.maxOutputTokens, 500);
        assert.strictEqual(_cooldowns.size, 0);

        // Lần sau không gửi thinkingConfig cho model đó nữa
        calls.length = 0;
        await callMultiProviderAI({ userPrompt: 'hi' });
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].body.generationConfig.thinkingConfig, undefined);
    } finally { restore(); }
});

test('OpenRouter 403 của 1 model chỉ khóa model đó, không khóa cả OpenRouter', async () => {
    const { calls, restore } = setup((model) => {
        if (model.startsWith('gemini')) return json(429, { error: 'quota' });
        if (model === 'baidu/ernie-5.5-flash-preview:free') return json(403, { error: { message: 'only available on agentic harnesses' } });
        return okOpenAI('nemotron ok');
    });
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi' }), 'nemotron ok');
        assert.ok(!_cooldowns.has('openrouter'));
        assert.ok(_cooldowns.has('openrouter::baidu/ernie-5.5-flash-preview:free'));
        // model reasoning được gửi kèm cấu hình tắt reasoning
        const nemo = calls.find(c => c.model === 'nvidia/nemotron-3.5-super-vl:free');
        assert.deepStrictEqual(nemo.body.reasoning, { enabled: false });
    } finally { restore(); }
});

test('Model trả về rỗng bị cooldown để lượt sau không chờ vô ích', async () => {
    const { calls, restore } = setup((model) => {
        if (model === 'gemini-3.8-flash') return json(200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] });
        return okGemini('ok');
    });
    try {
        await callMultiProviderAI({ userPrompt: 'a' });
        assert.ok(_cooldowns.has('gemini::gemini-3.8-flash'));
        calls.length = 0;
        await callMultiProviderAI({ userPrompt: 'b' });
        assert.deepStrictEqual(calls.map(c => c.model), ['gemini-3-flash-preview']);
    } finally { restore(); }
});
