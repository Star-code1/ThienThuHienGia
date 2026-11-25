// Chạy trọn luồng /baucua với Discord + DB giả lập: đặt cược trừ tiền ngay, lắc trả thưởng, huỷ thì hoàn tiền.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const mock = (rel, exports) => {
    const p = path.join(__dirname, rel);
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
};

// ── DB giả: số dư theo userId ──
const balances = new Map();
const stats = new Map();
const UserProfile = {
    async getOrCreate(userId) {
        if (!balances.has(userId)) balances.set(userId, 1000);
        return {
            userId,
            get linhThach() { return balances.get(userId); },
            async incLinhThach(delta, opts) {
                const r = await UserProfile.incLinhThachById(userId, delta, opts);
                return r ? r.applied : null;
            },
        };
    },
    async incLinhThachById(userId, delta, { requireFunds = false, inc = {} } = {}) {
        const bal = balances.get(userId) ?? 1000;
        if (requireFunds && delta < 0 && bal < -delta) return null;
        balances.set(userId, bal + delta);
        for (const [k, v] of Object.entries(inc)) stats.set(`${userId}.${k}`, (stats.get(`${userId}.${k}`) || 0) + v);
        return { applied: delta, linhThach: bal + delta, fields: {} };
    },
};
mock('../src/shared/models/UserProfile.js', UserProfile);
const fakeEscrow = require('./helpers/fakeEscrowModel');
mock('../src/shared/models/GameEscrow.js', fakeEscrow);
mock('../src/services/aiService.js', { generateBaucuaCommentary: async () => 'Lời bình thử nghiệm' });
mock('../src/shared/utils/nameHelper.js', { getDisplayName: (i) => i.user.name });

const baucua = require('../src/features/game-baucua');
const engine = require('../src/features/game-baucua/baucuaEngine');

function fakeChannel() {
    const sent = [];
    return { id: 'kenh-' + Math.random(), sent, send: async (payload) => { sent.push(payload); } };
}

async function openSession(channel) {
    let sessionId;
    await baucua.commands[0].execute({
        user: { id: 'host', name: 'Chủ Sòng' },
        channel,
        reply: async ({ components }) => {
            sessionId = components[0].components[0].data.custom_id.split(':')[1];
        },
        fetchReply: async () => ({ id: 'msg-' + Math.random(), edit: async () => {} }),
    });
    return sessionId;
}

async function bet(sessionId, userId, beast, amount) {
    let reply;
    await baucua.interactions.bc_submit({
        customId: `bc_submit:${sessionId}:${beast}`,
        user: { id: userId, name: userId },
        fields: { getTextInputValue: () => String(amount) },
        reply: async (r) => { reply = r.content; },
    });
    return reply;
}

const flush = () => new Promise((r) => setImmediate(r));

test('luồng Bầu Cua', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    await t.test('đặt cược trừ tiền ngay, không cho cược quá số dư kể cả ở 2 sòng', async () => {
        balances.clear();
        const ch = fakeChannel();
        const s1 = await openSession(ch);
        const s2 = await openSession(ch);
        assert.notStrictEqual(s1, s2);

        assert.match(await bet(s1, 'u1', 'bau', 700), /Thành công/);
        assert.strictEqual(balances.get('u1'), 300);
        assert.match(await bet(s2, 'u1', 'cua', 500), /không đủ Linh Thạch/);
        assert.strictEqual(balances.get('u1'), 300);
        assert.match(await bet(s2, 'u1', 'cua', 300), /Thành công/);
        assert.strictEqual(balances.get('u1'), 0);
        assert.match(await bet(s1, 'u1', 'bau', 'abc'), /không hợp lệ/);

        await baucua.onShutdown(); // dọn dẹp cho test sau
    });

    await t.test('hết giờ: lắc, trả vốn + thưởng và gửi kết quả', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        await bet(sid, 'u2', 'bau', 100);
        await bet(sid, 'u2', 'nai', 100);

        const realRandom = Math.random;
        Math.random = () => 0; // 3 mặt Bầu
        try {
            t.mock.timers.tick(30_000);
            for (let i = 0; i < 10; i++) await flush();
        } finally {
            Math.random = realRandom;
        }

        // 1000 - 200 cược + (100 vốn + 300 thưởng) cho Bầu
        assert.strictEqual(balances.get('u2'), 1200);
        assert.strictEqual(stats.get('u2.stats.baucuaGames'), 1);
        assert.strictEqual(stats.get('u2.stats.baucuaWinLinhThach'), 200);
        assert.strictEqual(ch.sent.length, 1);
        const desc = ch.sent[0].embeds[0].data.description;
        assert.match(desc, /Chủ Sòng/);
        assert.match(desc, /Lời bình thử nghiệm/);
        assert.match(await bet(sid, 'u2', 'bau', 10), /hết/); // sòng đã đóng
    });

    await t.test('bot tắt: huỷ sòng và hoàn trả toàn bộ tiền cược', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        await bet(sid, 'u3', 'ga', 400);
        await bet(sid, 'u4', 'ca', 250);
        assert.strictEqual(balances.get('u3'), 600);

        // /banchoi thấy sòng này trong đúng kênh
        const rooms = baucua.listRooms(ch.id);
        assert.strictEqual(rooms.length, 1);
        assert.match(rooms[0].title, /Chủ Sòng/);
        assert.match(rooms[0].detail, /2 người đã cược/);
        assert.deepStrictEqual(baucua.listRooms('kenh-khac'), []);

        await baucua.onShutdown();
        assert.strictEqual(balances.get('u3'), 1000);
        assert.strictEqual(balances.get('u4'), 1000);
        assert.match(ch.sent[0].embeds[0].data.title, /HUỶ/);

        t.mock.timers.tick(30_000); // timer cũ không được chạy nữa
        for (let i = 0; i < 5; i++) await flush();
        assert.strictEqual(balances.get('u3'), 1000);
        assert.strictEqual(ch.sent.length, 1);
    });

    assert.ok(engine.LINH_THU.length === 6);
});
