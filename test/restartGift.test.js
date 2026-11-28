// Quà đền bù khi bot khởi động lại: mọi người được +10.000, mỗi lượt phát chỉ một lần, có giãn cách chống sập liên tục.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mock = (rel, exports) => {
    const p = path.join(__dirname, rel);
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
};

// BotState giả: mô phỏng đúng findOneAndUpdate có điều kiện + upsert (đụng khoá trùng khi dòng đã có mà không khớp)
const states = new Map();
let stateQueue = Promise.resolve();
const matches = (doc, filter) => filter.$or.some((c) =>
    ('lastRestartGiftAt' in c && c.lastRestartGiftAt === null && doc.lastRestartGiftAt == null) ||
    (c.lastRestartGiftAt?.$lt && doc.lastRestartGiftAt && doc.lastRestartGiftAt < c.lastRestartGiftAt.$lt));
const BotState = {
    findOneAndUpdate(filter, update) {
        // tuần tự hoá như một thao tác nguyên tử của MongoDB
        const run = stateQueue.then(async () => {
            const doc = states.get(filter._id);
            if (doc && !matches(doc, filter)) { const e = new Error('dup'); e.code = 11000; throw e; }
            const next = { ...(doc || { _id: filter._id, restartGiftCount: 0 }), ...update.$set };
            next.restartGiftCount += update.$inc.restartGiftCount;
            states.set(filter._id, next);
            return next;
        });
        stateQueue = run.catch(() => {});
        return run;
    },
    async updateOne(filter, update) {
        const doc = states.get(filter._id);
        if (doc) { Object.assign(doc, update.$set); doc.restartGiftCount += update.$inc?.restartGiftCount || 0; }
    },
};

const balances = new Map();
let failUpdate = false;
const UserProfile = {
    async updateMany(filter, update) {
        if (failUpdate) throw new Error('db down');
        for (const [id, bal] of balances) balances.set(id, bal + update.$inc.linhThach);
        return { modifiedCount: balances.size };
    },
};
mock('../src/shared/models/BotState.js', BotState);
mock('../src/shared/models/UserProfile.js', UserProfile);

delete process.env.RESTART_GIFT_CHANNEL_ID; // dùng kênh mặc định
const gift = require('../src/services/restartGiftService');

const fakeClient = () => {
    const sent = [];
    return { sent, channels: { fetch: async (id) => ({ send: async (p) => sent.push({ id, ...p }) }) } };
};

test.beforeEach(() => {
    states.clear();
    balances.clear();
    balances.set('a', 0).set('b', 500).set('c', 1000);
    failUpdate = false;
});

test('khởi động lại → mọi người chơi +10.000 Linh Thạch và có thông báo ở kênh', async () => {
    const client = fakeClient();
    const r = await gift.grantRestartGift(client, { now: Date.parse('2026-11-28T10:00:00Z') });
    assert.deepEqual(r, { given: true, count: 3 });
    assert.deepEqual([...balances.values()], [10_000, 10_500, 11_000]);
    assert.equal(client.sent.length, 1);
    assert.equal(client.sent[0].id, '1534508222407245965');
    assert.match(client.sent[0].content, /10\.000/);
    assert.deepEqual(client.sent[0].allowedMentions, { parse: [] });
});

test('hai tiến trình khởi động cùng lúc (deploy) → chỉ phát MỘT lần', async () => {
    const now = Date.parse('2026-11-28T10:00:00Z');
    const results = await Promise.all([gift.grantRestartGift(null, { now }), gift.grantRestartGift(null, { now })]);
    assert.equal(results.filter((x) => x.given).length, 1);
    assert.equal(balances.get('a'), 10_000);
});

test('sập-khởi động liên tục trong thời gian giãn cách → không phát thêm; quá giãn cách thì phát tiếp', async () => {
    const t0 = Date.parse('2026-11-28T10:00:00Z');
    assert.equal((await gift.grantRestartGift(null, { now: t0 })).given, true);
    assert.equal((await gift.grantRestartGift(null, { now: t0 + 5 * 60_000 })).given, false);
    assert.equal(balances.get('a'), 10_000);
    assert.equal((await gift.grantRestartGift(null, { now: t0 + gift.COOLDOWN_MS + 1 })).given, true);
    assert.equal(balances.get('a'), 20_000);
    assert.equal(states.get('restart-gift').restartGiftCount, 2);
});

test('cộng Linh Thạch lỗi → không ai được cộng, trả lại lượt để lần sau phát được', async () => {
    const t0 = Date.parse('2026-11-28T10:00:00Z');
    failUpdate = true;
    assert.equal((await gift.grantRestartGift(null, { now: t0 })).given, false);
    assert.equal(balances.get('a'), 0);
    failUpdate = false;
    assert.equal((await gift.grantRestartGift(null, { now: t0 + 60_000 })).given, true);
    assert.equal(balances.get('a'), 10_000);
});
