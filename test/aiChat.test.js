const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Giả lập lưu phiên (không cần MongoDB)
const store = new Map();
const calls = [];
const mock = (rel, exports) => {
    const p = path.join(__dirname, rel);
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
};
mock('../src/services/aiSessionService.js', {
    getSession: async (key) => store.get(JSON.stringify(key)) || null,
    appendTurn: async (key, turn) => { calls.push({ key, ...turn }); return 1; },
});
// Giả lập Hiền Giả để test nhánh dự phòng (không gọi mạng/Qdrant thật)
const sageCalls = [];
mock('../src/services/aiService.js', {
    generateSageResponseWithContext: async (args) => {
        sageCalls.push(args);
        return { answer: 'Hiền Giả đáp thay.', sources: [{ title: 'Build Tố Vấn', url: 'https://x/a' }] };
    },
});

const { parseSseLine, askTieuHan, StaminaExhaustedError } = require('../src/services/tieuHanService');
const { runTurn, answerFromEmbedDescription, generate } = require('../src/features/ai-chat/chatFlow');

/** fetch giả trả về luồng SSE, cố tình cắt ngang giữa các dòng */
function mockSseFetch(pieces, captured = {}, links = null) {
    return async (url, opts) => {
        captured.body = JSON.parse(opts.body);
        const raw = pieces.map((t) => `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n`).join('')
            + (links ? `data: ${JSON.stringify({ type: 'related_links', links })}\n` : '')
            + 'data: {"type":"message_stop"}\n';
        const enc = new TextEncoder();
        const parts = [raw.slice(0, 17), raw.slice(17, 60), raw.slice(60)];
        return {
            ok: true,
            status: 200,
            headers: new Map([['x-stamina-remaining', '7'], ['x-stamina-max', '10']]),
            body: (async function* () { for (const p of parts) yield enc.encode(p); })(),
        };
    };
}

test('parseSseLine', () => {
    assert.deepStrictEqual(parseSseLine('data: {"type":"message_stop"}'), { type: 'message_stop' });
    assert.strictEqual(parseSseLine('event: ping'), null);
    assert.strictEqual(parseSseLine('data: [DONE]'), null);
    assert.strictEqual(parseSseLine('data: {hỏng'), null);
});

test('askTieuHan ghép đủ chữ dù luồng bị cắt giữa dòng, gửi kèm lịch sử', async () => {
    const captured = {};
    const orig = global.fetch;
    global.fetch = mockSseFetch(['Hi', 'hi, Tố Vấn', ' dùng **3 Kim 3 Thủy**.'], captured);
    const deltas = [];
    try {
        const { answer } = await askTieuHan([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }], { onDelta: (t) => deltas.push(t) });
        assert.strictEqual(answer, 'Hihi, Tố Vấn dùng **3 Kim 3 Thủy**.');
        assert.strictEqual(deltas.at(-1), answer);
        assert.strictEqual(captured.body.messages.length, 3);
    } finally {
        global.fetch = orig;
    }
});

test('runTurn (Tiểu Hàn): gửi tin chờ, sửa thành câu trả lời có nút, lưu phiên kèm lịch sử', async () => {
    const key = { guildId: 'g', channelId: 'c', userId: 'u1', bot: 'tieuhan' };
    store.set(JSON.stringify(key), { turns: 2, messages: [{ role: 'user', content: 'Build Tố Vấn?' }, { role: 'assistant', content: '3 Kim 3 Thủy' }] });
    const captured = {};
    const orig = global.fetch;
    global.fetch = mockSseFetch(['Thần Khí ', 'Thanh Phong'], captured);
    const edits = [];
    let sent;
    try {
        await runTurn({
            bot: 'tieuhan',
            key,
            question: 'Còn thần khí?',
            asker: { name: 'Star', avatarURL: 'https://cdn.discordapp.com/embed/avatars/0.png' },
            send: async (p) => { sent = p; return { id: 'msg1' }; },
            edit: async (p) => { edits.push(p); },
        });
    } finally {
        global.fetch = orig;
    }
    assert.match(sent.embeds[0].toJSON().description, /Tiểu Hàn đang lật sách/);
    assert.deepStrictEqual(captured.body.messages.map((m) => m.content), ['Build Tố Vấn?', '3 Kim 3 Thủy', 'Còn thần khí?']);

    const final = edits.at(-1);
    const e = final.embeds[0].toJSON();
    assert.match(e.description, /^> Còn thần khí\?\n\nThần Khí Thanh Phong$/);
    assert.match(e.footer.text, /lượt 3/);
    const ids = final.components[0].toJSON().components.map((b) => b.custom_id || b.url);
    assert.deepStrictEqual(ids, ['ai:more:tieuhan:u1', 'ai:reset:tieuhan:u1', 'https://wikinghichthuyhan.com']);
    assert.deepStrictEqual(calls.at(-1), { key, question: 'Còn thần khí?', answer: 'Thần Khí Thanh Phong', messageId: 'msg1' });
});

test('runTurn: API lỗi thì hiện thông báo lỗi, không lưu phiên', async () => {
    const before = calls.length;
    const orig = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    const edits = [];
    try {
        await runTurn({
            bot: 'tieuhan',
            key: { guildId: 'g', channelId: 'c', userId: 'u2', bot: 'tieuhan' },
            question: 'x',
            asker: { name: 'A', avatarURL: 'https://cdn.discordapp.com/embed/avatars/0.png' },
            send: async () => ({ id: 'm' }),
            edit: async (p) => { edits.push(p); },
        });
    } finally {
        global.fetch = orig;
    }
    assert.match(edits.at(-1).embeds[0].toJSON().description, /bận chút xíu/);
    assert.deepStrictEqual(edits.at(-1).components, []);
    assert.strictEqual(calls.length, before);
});

test('answerFromEmbedDescription bỏ phần trích câu hỏi', () => {
    assert.strictEqual(answerFromEmbedDescription('> câu hỏi\n> dòng 2\n\nTrả lời **đây**'), 'Trả lời **đây**');
});

test('askTieuHan: 429 ném StaminaExhaustedError kèm mốc hồi lượt', async () => {
    const orig = global.fetch;
    global.fetch = async () => ({
        ok: false, status: 429,
        headers: new Map([['x-stamina-remaining', '0'], ['x-stamina-max', '10']]),
        text: async () => JSON.stringify({ message: 'Hết lượt', staminaRemaining: 0, staminaMax: 10, nextRefillAt: 1795080179296 }),
    });
    try {
        await assert.rejects(
            askTieuHan([{ role: 'user', content: 'a' }]),
            (e) => e instanceof StaminaExhaustedError && e.stamina.nextRefillAt === 1795080179296 && e.stamina.max === 10
        );
    } finally {
        global.fetch = orig;
    }
});

test('generate: Tiểu Hàn hết lượt -> Hiền Giả đáp thay, kèm ghi chú và nguồn', async () => {
    const before = sageCalls.length;
    const orig = global.fetch;
    global.fetch = async () => ({
        ok: false, status: 429,
        headers: new Map(),
        text: async () => JSON.stringify({ staminaRemaining: 0, staminaMax: 10, nextRefillAt: Date.now() + 5 * 60000 }),
    });
    try {
        const res = await generate('tieuhan', { question: 'Build Tố Vấn?', history: [], key: { guildId: 'g', channelId: 'c', userId: 'u' }, displayName: 'Star' });
        assert.match(res.answer, /Tiểu Hàn đang nghỉ.*hồi lượt ~5 phút/s);
        assert.match(res.answer, /Hiền Giả đáp thay\./);
        assert.strictEqual(res.fellBack, true);
        assert.deepStrictEqual(res.sources, [{ title: 'Build Tố Vấn', url: 'https://x/a' }]);
        assert.strictEqual(sageCalls.length, before + 1);
    } finally {
        global.fetch = orig;
    }
});

test('askTieuHan: thu related_links, ghép tên miền cho URL tương đối, bỏ trùng', async () => {
    const orig = global.fetch;
    global.fetch = mockSseFetch(['Đáp án'], {}, [
        { title: 'Build Long Ngâm', url: '/luu-phai/build-long-ngam', category: 'luu-phai' },
        { title: 'Cốt truyện', url: '/wiki/tom-tat-long-ngam', category: 'cot-truyen' },
        { title: 'Trùng', url: '/luu-phai/build-long-ngam' },
        { title: 'Ngoài', url: 'https://khac.com/x' },
    ]);
    try {
        const { links } = await askTieuHan([{ role: 'user', content: 'Long Ngâm?' }]);
        assert.deepStrictEqual(links.map((l) => l.url), [
            'https://wikinghichthuyhan.com/luu-phai/build-long-ngam',
            'https://wikinghichthuyhan.com/wiki/tom-tat-long-ngam',
            'https://khac.com/x',
        ]);
    } finally {
        global.fetch = orig;
    }
});

test('generate (Tiểu Hàn): related_links thành sources để hiện ở "Xem thêm"', async () => {
    const orig = global.fetch;
    global.fetch = mockSseFetch(['Xong'], {}, [{ title: 'Build Long Ngâm', url: '/luu-phai/build-long-ngam' }]);
    try {
        const res = await generate('tieuhan', { question: 'Long Ngâm build gì khác nhau?', history: [], key: { guildId: 'g', channelId: 'c', userId: 'u' }, displayName: 'Star' });
        assert.deepStrictEqual(res.sources, [{ title: 'Build Long Ngâm', url: 'https://wikinghichthuyhan.com/luu-phai/build-long-ngam', category: '' }]);
    } finally {
        global.fetch = orig;
    }
});

test('generate: câu hỏi mới trùng được trả từ cache, không gọi API lần 2', async () => {
    let apiCalls = 0;
    const orig = global.fetch;
    global.fetch = mockSseFetch(['Đáp ', 'án']);
    const base = { history: [], key: { guildId: 'g', channelId: 'c', userId: 'u' }, displayName: 'Star' };
    try {
        const wrap = global.fetch;
        global.fetch = (...a) => { apiCalls++; return wrap(...a); };
        const r1 = await generate('tieuhan', { ...base, question: 'Câu HỎI  trùng nhau?' });
        const r2 = await generate('tieuhan', { ...base, question: 'câu hỏi trùng nhau?' });
        assert.strictEqual(r1.answer, 'Đáp án');
        assert.strictEqual(r2.answer, 'Đáp án');
        assert.strictEqual(apiCalls, 1);
    } finally {
        global.fetch = orig;
    }
});
