const test = require('node:test');
const assert = require('node:assert');
const { callMultiProviderAI, _cooldowns } = require('../src/services/aiProviders');

function jsonResponse(status, body, headers = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers }
    });
}

const okOpenAI = text => jsonResponse(200, { choices: [{ message: { content: text } }] });
const okGemini = text => jsonResponse(200, { candidates: [{ content: { parts: [{ text }] } }] });

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
        calls.push(model);
        return handler(model, url);
    };
    const restore = () => {
        global.fetch = originalFetch;
        process.env = originalEnv;
        _cooldowns.clear();
    };
    return { calls, restore };
}

test('model đầu tiên OK thì trả ngay', async () => {
    const { calls, restore } = setup(() => okGemini('chào'));
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi' }), 'chào');
        assert.deepStrictEqual(calls, ['gemini-3.8-flash']);
    } finally { restore(); }
});

test('OpenRouter 429 thì bỏ qua toàn bộ model OpenRouter còn lại, chuyển sang Gemini', async () => {
    const { calls, restore } = setup((model) => {
        if (model === 'gemini-3.8-flash' || model === 'gemini-3-flash-preview') return jsonResponse(429, { error: 'quota' });
        if (model.includes(':free')) return jsonResponse(429, { error: { message: 'Rate limit exceeded: free-models-per-day' } });
        return okGemini('từ flash lite');
    });
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi' }), 'từ flash lite');
        assert.deepStrictEqual(calls, ['gemini-3.8-flash', 'gemini-3-flash-preview', 'baidu/ernie-5.5-flash-preview:free', 'gemini-3.1-flash-lite']);
        assert.ok(_cooldowns.has('openrouter'), 'OpenRouter phải bị cooldown cấp provider');
        assert.ok(_cooldowns.has('gemini::gemini-3.8-flash'), 'Gemini chỉ cooldown cấp model');
    } finally { restore(); }
});

test('Lượt gọi sau bỏ qua target đang cooldown', async () => {
    const { calls, restore } = setup((model) => {
        if (model === 'gemini-3.8-flash') return jsonResponse(429, '{}', { 'retry-after': '120' });
        return okGemini('preview ok');
    });
    try {
        await callMultiProviderAI({ userPrompt: 'a' });
        calls.length = 0;
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'b' }), 'preview ok');
        assert.deepStrictEqual(calls, ['gemini-3-flash-preview']);
    } finally { restore(); }
});

test('400 chỉ bỏ qua model đó, không cooldown', async () => {
    const { calls, restore } = setup((model) => {
        if (model === 'gemini-3.8-flash') return jsonResponse(400, { error: 'bad param' });
        return okGemini('ok');
    });
    try {
        assert.strictEqual(await callMultiProviderAI({ userPrompt: 'hi' }), 'ok');
        assert.strictEqual(calls.length, 2);
        assert.strictEqual(_cooldowns.size, 0);
    } finally { restore(); }
});

test('Giới hạn số lần thử mỗi lượt', async () => {
    const { calls, restore } = setup(() => jsonResponse(400, 'bad'));
    try {
        await assert.rejects(callMultiProviderAI({ userPrompt: 'hi' }));
        assert.strictEqual(calls.length, 8);
    } finally { restore(); }
});
