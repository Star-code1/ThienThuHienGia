// Xì Dách & Poker: tiền được giữ ngay khi vào bàn, hoàn đủ khi rời/huỷ, và tổng tiền luôn được bảo toàn.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const mock = (rel, exports) => {
    const p = path.join(__dirname, rel);
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
};

const balances = new Map();
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
            addTuVi: () => 'Phàm Nhân',
            save: async () => {},
        };
    },
    async incLinhThachById(userId, delta, { requireFunds = false } = {}) {
        const bal = balances.get(userId) ?? 1000;
        if (requireFunds && delta < 0 && bal < -delta) return null;
        balances.set(userId, bal + delta);
        return { applied: delta, linhThach: bal + delta, fields: {} };
    },
};
mock('../src/shared/models/UserProfile.js', UserProfile);
const fakeEscrow = require('./helpers/fakeEscrowModel');
mock('../src/shared/models/GameEscrow.js', fakeEscrow);
mock('../src/services/aiService.js', { generatePokerCommentary: async () => 'Lời bình' });
mock('../src/shared/utils/nameHelper.js', { getDisplayName: (i) => i.user.name });

const blackjack = require('../src/features/game-blackjack');
const poker = require('../src/features/game-poker');

const fakeMessage = { url: 'x', channelId: 'ch', edit: async () => {} };
const bjHandler = blackjack.interactions.bj_join;
const bjOpen = blackjack.commands[0].execute;

function bjInteraction(userId, customId, extra = {}) {
    return {
        user: { id: userId, name: userId }, channelId: 'ch', customId, message: fakeMessage,
        options: { getInteger: () => 200 },
        replies: [],
        reply(p) { this.replies.push(p); return Promise.resolve(); },
        fetchReply: async () => fakeMessage,
        update(p) { this.replies.push(p); return Promise.resolve(); },
        deferUpdate: async () => {},
        ...extra,
    };
}

test.beforeEach(() => balances.clear());

test('Xì Dách: mở bàn trừ cược ngay, không đủ tiền thì từ chối', async () => {
    balances.set('poor', 100);
    const i = bjInteraction('poor', '');
    await bjOpen(i);
    assert.equal(balances.get('poor'), 100);
    assert.match(i.replies[0].content, /không đủ Linh Thạch/);
    assert.equal(blackjack._internal.tables.size, 0);
});

test('Xì Dách: rời bàn / huỷ bàn hoàn đủ cược', async () => {
    await bjOpen(bjInteraction('a', ''));
    assert.equal(balances.get('a'), 800);
    const [table] = blackjack._internal.tables.values();

    await bjHandler(bjInteraction('b', `bj_join:${table.id}`));
    assert.equal(balances.get('b'), 800);
    await bjHandler(bjInteraction('b', `bj_leave:${table.id}`));
    assert.equal(balances.get('b'), 1000);

    await blackjack.onShutdown();
    assert.equal(balances.get('a'), 1000);
    assert.equal(blackjack._internal.tables.size, 0);
});

test('Xì Dách: chơi trọn ván — tiền của mỗi người = số dư đầu + lãi/lỗ, nhà cái chi đúng bằng người thắng', async () => {
    for (let round = 0; round < 25; round++) {
        balances.clear();
        await bjOpen(bjInteraction('a', ''));
        const [table] = blackjack._internal.tables.values();
        await bjHandler(bjInteraction('b', `bj_join:${table.id}`));
        await bjHandler(bjInteraction('a', `bj_start:${table.id}`));

        let guard = 0;
        while (blackjack._internal.tables.has(table.id) && guard++ < 20) {
            const cur = table.players[table.turn];
            if (!cur) break;
            await bjHandler(bjInteraction(cur.id, `bj_stand:${table.id}`));
        }
        assert.equal(table.phase, 'done');
        for (const p of table.players) {
            assert.equal(balances.get(p.id), 1000 + p.delta, `${p.id} vòng ${round}`);
            assert.ok(p.delta >= -p.escrow, 'không thua quá số cược');
        }
    }
});

test('Xì Dách: Gấp đôi giữ thêm đúng một lần cược; ván xong thanh toán trên 2 lần cược', async () => {
    let doubled = 0;
    for (let round = 0; round < 40 && doubled < 3; round++) {
        balances.clear();
        await bjOpen(bjInteraction('a', ''));
        const [table] = blackjack._internal.tables.values();
        await bjHandler(bjInteraction('a', `bj_start:${table.id}`));
        const me = table.players[0];
        if (table.phase !== 'playing' || table.players[table.turn] !== me) continue; // có Xì Dách ngay
        await bjHandler(bjInteraction('a', `bj_double:${table.id}`));
        doubled++;
        assert.equal(me.escrow, 400);
        assert.equal(table.phase, 'done');
        assert.ok([-400, 0, 400].includes(me.delta), 'delta=' + me.delta);
        assert.equal(balances.get('a'), 1000 + me.delta);
    }
    assert.ok(doubled > 0);
});

// ───────────────────────────── Poker ─────────────────────────────

const pkInteraction = (userId, customId, extra = {}) => ({
    id: `pk-${Math.random()}`,
    user: { id: userId, name: userId }, channelId: 'ch', customId, message: fakeMessage,
    options: { getString: () => 'solo', getInteger: (n) => (n === 'cuoc' ? 100 : 1) },
    replies: [],
    reply(p) { this.replies.push(p); return Promise.resolve({ resource: { message: fakeMessage } }); },
    deferUpdate: async () => {},
    followUp(p) { this.replies.push(p); return Promise.resolve(); },
    editReply(p) { this.replies.push(p); return Promise.resolve(); },
    ...extra,
});

test('Poker: không đủ tiền mua chip thì không vào được và không mất tiền', async () => {
    balances.set('p1', 1500); // buy-in = 20 × 100 = 2000
    const i = pkInteraction('p1', '');
    await poker.commands[0].execute(i);
    assert.equal(balances.get('p1'), 1500);
    assert.match(i.replies[0].content, /mua chip/);
    assert.equal(poker._internal.tables.size, 0);
});

test('Poker: mua chip bị trừ ngay; huỷ giữa ván trả lại đủ (kể cả phần đã bỏ vào pot)', async () => {
    balances.set('p1', 5000);
    await poker.commands[0].execute(pkInteraction('p1', ''));
    assert.equal(balances.get('p1'), 3000);
    assert.equal(poker._internal.tables.size, 1);

    await poker.onShutdown();
    assert.equal(balances.get('p1'), 5000);
    assert.equal(poker._internal.tables.size, 0);
});

test('Poker: kết thúc ván rồi rời/giải tán — Linh Thạch = số dư đầu + lãi/lỗ của ván', async () => {
    for (let round = 0; round < 10; round++) {
        balances.clear();
        balances.set('p1', 5000);
        await poker.commands[0].execute(pkInteraction('p1', ''));
        const [table] = poker._internal.tables.values();

        let guard = 0;
        while (['preflop', 'flop', 'turn', 'river'].includes(table.stage) && guard++ < 10) {
            const actor = table.players[table.toAct];
            if (!actor || actor.isBot) break;
            await poker.interactions.pk(pkInteraction('p1', `pk:${table.id}:fold`));
        }
        assert.equal(table.stage, 'lobby');
        const net = table.lastResult.rows.find((r) => r.id === 'p1').net;

        await poker.interactions.pk(pkInteraction('p1', `pk:${table.id}:end`));
        assert.equal(poker._internal.tables.size, 0);
        await new Promise((r) => setImmediate(r)); // cho lệnh hoàn chip chạy xong
        assert.equal(balances.get('p1'), 5000 + net, `vòng ${round}`);
    }
});

// ───────────── Sổ tiền đang giữ + khôi phục khi bot sập + nhiều room ─────────────

const escrowService = require('../src/services/escrowService');

test.beforeEach(() => fakeEscrow.reset());

test('sổ tiền: giữ khi vào bàn, xoá sạch khi ván xong / rời bàn / giải tán', async () => {
    await bjOpen(bjInteraction('a', ''));
    const [table] = blackjack._internal.tables.values();
    assert.deepEqual(fakeEscrow.docs.map((d) => [d.userId, d.game, d.amount]), [['a', 'xidach', 200]]);
    await bjHandler(bjInteraction('a', `bj_start:${table.id}`));
    for (let g = 0; g < 10 && blackjack._internal.tables.has(table.id); g++) {
        await bjHandler(bjInteraction(table.players[table.turn].id, `bj_stand:${table.id}`));
    }
    assert.equal(fakeEscrow.docs.length, 0);

    balances.set('p1', 5000);
    await poker.commands[0].execute(pkInteraction('p1', ''));
    assert.deepEqual(fakeEscrow.docs.map((d) => [d.game, d.amount]), [['poker', 2000]]);
    await poker.onShutdown();
    assert.equal(fakeEscrow.docs.length, 0);
});

test('một người mở/ngồi nhiều room cùng lúc (Xì Dách & Poker), tiền giữ riêng từng room', async () => {
    balances.set('a', 5000);
    await bjOpen(bjInteraction('a', ''));
    await bjOpen(bjInteraction('a', ''));
    assert.equal(blackjack._internal.tables.size, 2);
    assert.equal(balances.get('a'), 4600);
    const [t1, t2] = blackjack._internal.tables.values();
    await bjHandler(bjInteraction('b', `bj_join:${t1.id}`));
    await bjHandler(bjInteraction('b', `bj_join:${t2.id}`));
    assert.equal(t1.players.length, 2);
    assert.equal(t2.players.length, 2);
    assert.equal(fakeEscrow.docs.length, 4);

    await poker.commands[0].execute(pkInteraction('a', ''));
    await poker.commands[0].execute(pkInteraction('a', ''));
    assert.equal(poker._internal.tables.size, 2);
    assert.equal(balances.get('a'), 4600 - 4000);

    await blackjack.onShutdown();
    await poker.onShutdown();
    assert.equal(balances.get('a'), 5000);
    assert.equal(balances.get('b'), 1000);
    assert.equal(fakeEscrow.docs.length, 0);
});

test('bot sập giữa ván → hoàn tiền + đền bù 10.000 và báo tin cho từng người', async () => {
    balances.set('a', 5000);
    await bjOpen(bjInteraction('a', ''));                         // giữ 200
    const [table] = blackjack._internal.tables.values();
    await bjHandler(bjInteraction('b', `bj_join:${table.id}`));    // b giữ 200
    await poker.commands[0].execute(pkInteraction('a', ''));       // a giữ thêm 2000 chip
    assert.equal(balances.get('a'), 5000 - 200 - 2000);
    assert.equal(balances.get('b'), 800);

    // "Sập": không chạy onShutdown, tiến trình biến mất → tim ngừng đập
    const longAgo = new Date(Date.now() - escrowService.STALE_MS - 5000);
    for (const d of fakeEscrow.docs) d.heartbeatAt = longAgo;
    blackjack._internal.tables.clear();

    const dms = []; const channelMsgs = [];
    const client = {
        users: { fetch: async (id) => ({ send: async (t) => { if (id === 'b') throw new Error('DM closed'); dms.push([id, t]); } }) },
        channels: { fetch: async () => ({ send: async (p) => { channelMsgs.push(p); } }) },
    };
    const n = await escrowService.recoverStale(client);
    assert.equal(n, 2);
    assert.equal(balances.get('a'), 5000 + escrowService.COMPENSATION);   // hoàn đủ + 10.000, mỗi người MỘT lần đền bù
    assert.equal(balances.get('b'), 1000 + escrowService.COMPENSATION);
    assert.equal(fakeEscrow.docs.length, 0);
    assert.equal(dms.length, 1);
    assert.match(dms[0][1], /Xì Dách/);
    assert.match(dms[0][1], /Poker/);
    assert.match(dms[0][1], /10\.000/);
    assert.equal(channelMsgs.length, 1);                                  // b đóng DM → báo ở kênh
    assert.match(channelMsgs[0].content, /<@b>/);

    assert.equal(await escrowService.recoverStale(client), 0);            // không trả lần hai
    assert.equal(balances.get('a'), 5000 + escrowService.COMPENSATION);

    await poker.onShutdown();
});

test('khôi phục chỉ áp dụng cho dòng đã mất heartbeat, không đụng ván đang chạy', async () => {
    await bjOpen(bjInteraction('a', ''));
    assert.equal(await escrowService.recoverStale({}), 0);
    assert.equal(balances.get('a'), 800);
    await blackjack.onShutdown();
});
