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
const txMarks = new Map();
const UserProfile = {
    async getEscrowTxs(userId) { return txMarks.get(userId) || []; },
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
    async incLinhThachById(userId, delta, { requireFunds = false, inc = {}, tx = null } = {}) {
        const bal = balances.get(userId) ?? 1000;
        if (requireFunds && delta < 0 && bal < -delta) return null;
        balances.set(userId, bal + delta);
        if (tx) { if (!txMarks.has(userId)) txMarks.set(userId, []); txMarks.get(userId).push(tx); }
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

async function press(kind, sessionId, userId = 'host', perms = null) {
    let reply;
    await baucua.interactions['bc_' + kind]({
        customId: `bc_${kind}:${sessionId}`,
        user: { id: userId, name: userId },
        memberPermissions: perms,
        deferUpdate: async () => {},
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

    await t.test('chủ sòng bấm Lắc rồi Khui: trả vốn + thưởng và gửi kết quả', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        await bet(sid, 'u2', 'bau', 100);
        await bet(sid, 'u2', 'nai', 100);

        // người ngoài không lắc được; sòng chưa lắc thì chưa khui được
        assert.match(await press('shake', sid, 'ke-la'), /Chỉ chủ sòng/);
        assert.match(await press('open', sid), /chưa lắc/);

        const realRandom = Math.random;
        Math.random = () => 0; // 3 mặt Bầu
        try {
            await press('shake', sid);
            for (let i = 0; i < 5; i++) await flush();
        } finally {
            Math.random = realRandom;
        }
        // đã lắc: đóng cược, chưa trả thưởng, chưa có kết quả
        assert.strictEqual(balances.get('u2'), 800);
        assert.strictEqual(ch.sent.length, 0);
        assert.match(await bet(sid, 'u3', 'bau', 10), /đóng cược/);
        assert.match(await press('shake', sid), /đã lắc rồi/);
        assert.match(await press('open', sid, 'ke-la'), /Chỉ chủ sòng/);

        await press('open', sid);
        for (let i = 0; i < 10; i++) await flush();

        // 1000 - 200 cược + (100 vốn + 300 thưởng) cho Bầu
        assert.strictEqual(balances.get('u2'), 1200);
        assert.strictEqual(stats.get('u2.stats.baucuaGames'), 1);
        assert.strictEqual(stats.get('u2.stats.baucuaWinLinhThach'), 200);
        assert.strictEqual(ch.sent.length, 1);
        const desc = ch.sent[0].embeds[0].data.description;
        assert.match(desc, /Chủ Sòng/);
        assert.match(desc, /Lời bình thử nghiệm/);
        assert.match(await bet(sid, 'u2', 'bau', 10), /đóng cược/); // sòng đã đóng
    });

    await t.test('bot tắt êm: sòng đã có người cược được LẮC NGAY cho xong ván (không huỷ), sòng trống thì đóng', async () => {
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
        // Ván được hoàn thành: có bảng kết quả, tiền = số dư đầu + lãi/lỗ (cược 400 vào Gà: -400, hoặc +400×số con trúng)
        assert.match(ch.sent[0].embeds[0].data.title, /KẾT QUẢ/);
        assert.ok((balances.get('u3') - 600) % 400 === 0 && balances.get('u3') >= 600);
        assert.ok((balances.get('u4') - 750) % 250 === 0 && balances.get('u4') >= 750);
        assert.strictEqual(fakeEscrow.docs.length, 0);

        t.mock.timers.tick(10 * 60_000); // timer cũ không được chạy nữa
        for (let i = 0; i < 5; i++) await flush();
        assert.strictEqual(ch.sent.length, 1);
    });

    await t.test('bot tắt êm: sòng chưa ai cược thì đóng và không trừ ai', async () => {
        balances.clear();
        const ch = fakeChannel();
        await openSession(ch);
        await baucua.onShutdown();
        assert.match(ch.sent[0].embeds[0].data.title, /HUỶ/);
    });

    await t.test('lắc khi chưa ai cược bị từ chối; quá 10 phút chưa lắc thì huỷ và hoàn tiền', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        assert.match(await press('shake', sid), /Chưa có ai đặt cược/);
        await bet(sid, 'u5', 'tom', 300);
        assert.strictEqual(balances.get('u5'), 700);
        t.mock.timers.tick(10 * 60_000);
        for (let i = 0; i < 10; i++) await flush();
        assert.strictEqual(balances.get('u5'), 1000);
        assert.match(ch.sent[0].embeds[0].data.title, /HUỶ/);
    });

    await t.test('đã lắc mà chủ sòng bỏ đi: sau 5 phút bát tự khui, tiền được trả', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        await bet(sid, 'u6', 'ga', 100);
        await press('shake', sid);
        for (let i = 0; i < 5; i++) await flush();
        t.mock.timers.tick(5 * 60_000);
        for (let i = 0; i < 10; i++) await flush();
        assert.match(ch.sent[0].embeds[0].data.title, /KẾT QUẢ/);
        assert.strictEqual(fakeEscrow.docs.length, 0);
    });

    await t.test('người có quyền Quản lý tin nhắn lắc/khui thay được', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        await bet(sid, 'u7', 'ca', 100);
        const mod = { has: () => true };
        await press('shake', sid, 'mod', mod);
        await press('open', sid, 'mod', mod);
        for (let i = 0; i < 10; i++) await flush();
        assert.match(ch.sent[0].embeds[0].data.title, /KẾT QUẢ/);
    });

    await t.test('bảng kết quả có nút Ván mới: bấm một lần mở sòng mới cho người bấm', async () => {
        balances.clear();
        const ch = fakeChannel();
        const sid = await openSession(ch);
        await bet(sid, 'u8', 'cua', 100);
        await press('shake', sid);
        await press('open', sid);
        for (let i = 0; i < 10; i++) await flush();
        const btn = ch.sent[0].components[0].components[0].data;
        assert.strictEqual(btn.custom_id, `bc_again:${sid}`);

        const click = (uid) => {
            const out = { replies: [], updates: [] };
            return [out, {
                customId: btn.custom_id, channel: ch, user: { id: uid, name: uid },
                update: async (p) => { out.updates.push(p); },
                reply: async (r) => { out.replies.push(r.content); },
            }];
        };
        const [o1, i1] = click('nguoi-moi');
        await baucua.interactions.bc_again(i1);
        assert.strictEqual(o1.updates.length, 1);
        assert.strictEqual(ch.sent.length, 2);
        assert.match(ch.sent[1].embeds[0].data.title, /KHAI MỞ/);
        assert.match(ch.sent[1].embeds[0].data.description, /nguoi-moi/);
        const [o2, i2] = click('khac');
        await baucua.interactions.bc_again(i2);
        assert.match(o2.replies[0], /đã được mở/);
        assert.strictEqual(ch.sent.length, 2);
        await baucua.onShutdown();
    });

    assert.ok(engine.LINH_THU.length === 6);
});

test('Bầu Cua: bắt đầu lắc là đóng cược, cược muộn không bị trừ tiền', async () => {
    balances.clear();
    const ch = fakeChannel();
    const s = await openSession(ch);
    assert.match(await bet(s, 'u1', 'bau', 100), /Thành công/);
    await baucua.onShutdown(); // sòng có người cược → lắc ngay rồi đóng cược
    const late = await bet(s, 'u2', 'cua', 500);
    assert.match(late, /đóng cược/);
    assert.equal(balances.get('u2') ?? 1000, 1000);
});
