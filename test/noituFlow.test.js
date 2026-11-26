const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Giả lập AI & hồ sơ người chơi để test luồng Nối Từ / Vua Tiếng Việt không cần mạng hay DB.
const root = path.join(__dirname, '..', 'src');
const aiPath = require.resolve(path.join(root, 'services', 'aiService'));
const profilePath = require.resolve(path.join(root, 'shared', 'models', 'UserProfile'));

const ledger = [];
const bests = {};
let aiVerdict = { valid: true, reason: 'Hay lắm' };
let aiDelay = 0;

const realAi = require(aiPath);
require.cache[aiPath].exports = {
    ...realAi,
    validateWordVI: async (last, cur) => {
        // dùng đúng pre-check thật để kiểm tra luật nối
        const real = await realAi.validateWordVI(last, cur).catch(() => null);
        if (real && !real.valid && !real.unavailable) return real;
        if (aiDelay) await new Promise((r) => setTimeout(r, aiDelay));
        return aiVerdict;
    },
    validateWordEN: async (last, cur) => {
        const real = await realAi.validateWordEN(last, cur).catch(() => null);
        if (real && !real.valid && !real.unavailable) return real;
        return aiVerdict;
    },
    getRandomEnglishStartWord: async () => 'Dragon',
    generateVuaTiengVietQuestion: async (difficulty, used) => {
        const word = ['HOÀNG HÔN', 'BÌNH MINH', 'GIANG HỒ'].find((w) => !used.includes(w));
        return { originalWord: word, scrambledLetters: 'x y z', structure: '2 tiếng', hint: 'gợi ý' };
    },
};
require.cache[profilePath] = {
    id: profilePath, filename: profilePath, loaded: true,
    exports: {
        getOrCreate: async (userId) => ({
            stats: {},
            set: (k, v) => { bests[userId + ':' + k] = v; },
            incLinhThach: async (d) => { ledger.push({ userId, d }); },
            addTuVi: () => 'Phàm Nhân',
            save: async () => {},
        }),
    },
};

const noitu = require('../src/features/game-noitu');
const vua = require('../src/features/game-vuatiengviet');
const { releaseChannel } = require('../src/shared/channelGames');

function fakeMessage(channelId, userId, content) {
    const calls = { reacts: [], replies: [], sends: [] };
    return {
        calls,
        author: { id: userId, bot: false, displayAvatarURL: () => 'https://example.com/a.png' },
        guild: {},
        channelId,
        content,
        member: { displayName: userId },
        react: async (e) => { calls.reacts.push(e); },
        reply: async (p) => { calls.replies.push(p); },
        channel: { send: async (p) => { calls.sends.push(p); } },
    };
}

const handler = noitu.events[0].execute;
const vuaHandler = vua.events[0].execute;

function openGame(channelId, lastWord, lang = 'vi') {
    const { activeGames, newGame } = noitu._internal;
    const g = newGame(lang, lastWord);
    activeGames.set(channelId, g);
    return g;
}

test.afterEach(() => {
    for (const id of [...noitu._internal.activeGames.keys()]) noitu._internal.endGame(id);
    for (const id of [...vua._internal.activeVuaGames.keys()]) vua._internal.endGame(id);
    ledger.length = 0;
    aiVerdict = { valid: true, reason: 'Hay lắm' };
    aiDelay = 0;
});

test('Nối Từ: trò chuyện thường bị bỏ qua, không phản hồi gì', async () => {
    openGame('c1', 'Tu Tiên');
    for (const text of ['xin chào mọi người', 'hello', 'ok', 'ăn cơm chưa cả nhà ơi nhỉ', '😀']) {
        const m = fakeMessage('c1', 'u1', text);
        await handler(m);
        assert.deepEqual(m.calls.replies, [], text);
        assert.deepEqual(m.calls.sends, [], text);
    }
    assert.equal(ledger.length, 0);
});

test('Nối Từ: nối đúng được thưởng, sai tiếng nối chỉ thả ❌', async () => {
    const g = openGame('c2', 'Tu Tiên');
    const bad = fakeMessage('c2', 'u1', 'Giới hạn');
    await handler(bad);
    assert.deepEqual(bad.calls.reacts, ['❌']);
    assert.equal(bad.calls.replies.length, 0);

    const ok = fakeMessage('c2', 'u1', 'tiên giới');
    await handler(ok);
    assert.deepEqual(ok.calls.reacts, ['✅']);
    assert.equal(g.lastWord, 'tiên giới');
    assert.deepEqual(ledger, [{ userId: 'u1', d: 50 }]);
});

test('Nối Từ: từ trùng bị chặn kể cả khác kiểu gõ hoa/thường', async () => {
    const g = openGame('c3', 'Tu Tiên');
    g.usedWords.add('tiên giới');
    const m = fakeMessage('c3', 'u1', 'TIÊN GIỚI'.replace('GIỚI', 'GIỚI'));
    await handler(m);
    assert.equal(m.calls.replies.length, 1);
    assert.equal(ledger.length, 0);
});

test('Nối Từ: AI lỗi KHÔNG tự duyệt từ và không phát thưởng', async () => {
    aiVerdict = { valid: false, unavailable: true, reason: 'bế quan' };
    const g = openGame('c4', 'Tu Tiên');
    const m = fakeMessage('c4', 'u1', 'tiên xyz');
    await handler(m);
    assert.equal(g.lastWord, 'Tu Tiên');
    assert.equal(ledger.length, 0);
});

test('Nối Từ: không được nối 2 lượt liền khi đã có ≥2 người chơi', async () => {
    const g = openGame('c5', 'Tu Tiên');
    g.players.add('u1'); g.players.add('u2');
    g.lastPlayerId = 'u1';
    const m = fakeMessage('c5', 'u1', 'tiên giới');
    await handler(m);
    assert.equal(g.lastWord, 'Tu Tiên');
    assert.equal(ledger.length, 0);
    const m2 = fakeMessage('c5', 'u2', 'tiên giới');
    await handler(m2);
    assert.equal(g.lastWord, 'tiên giới');
});

test('Nối Từ: chỉ một người thắng khi hai tin đến cùng lúc (khoá busy)', async () => {
    aiDelay = 30;
    const g = openGame('c6', 'Tu Tiên');
    const a = fakeMessage('c6', 'u1', 'tiên giới');
    const b = fakeMessage('c6', 'u2', 'tiên nhân');
    await Promise.all([handler(a), handler(b)]);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].d, 50);
    assert.ok(['tiên giới', 'tiên nhân'].includes(g.lastWord));
});

test('Nối Từ EN: chỉ nhận một từ, đúng chữ cái nối', async () => {
    const g = openGame('c7', 'Dragon', 'en');
    aiVerdict = { valid: true, reason: 'ok', meaning: 'quả' };
    for (const text of ['two words', 'apple']) {
        const m = fakeMessage('c7', 'u1', text);
        await handler(m);
    }
    assert.equal(g.lastWord, 'Dragon');
    const good = fakeMessage('c7', 'u1', 'nirvana');
    await handler(good);
    assert.equal(g.lastWord, 'nirvana');
});

test('Vua Tiếng Việt: hai người đúng cùng lúc chỉ một người nhận thưởng', async () => {
    const { activeVuaGames } = vua._internal;
    const game = {
        difficulty: 'de', originalWord: 'HOÀNG HÔN', scrambledLetters: 'x', structure: '2 tiếng', hint: 'h',
        hintUsed: false, usedWords: ['HOÀNG HÔN'], authorId: 'u0', consecutiveTimeouts: 0, timer: null,
        solving: false, askedAt: Date.now() - 40_000,
    };
    activeVuaGames.set('v1', game);
    await Promise.all([
        vuaHandler(fakeMessage('v1', 'u1', 'hoang hon')),
        vuaHandler(fakeMessage('v1', 'u2', 'Hoàng Hôn!')),
    ]);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].d, 50);               // đoán sau 40s: không có thưởng nhanh
    assert.equal(game.originalWord, 'BÌNH MINH'); // đã sang câu kế
    assert.equal(game.solving, false);
    clearTimeout(game.timer);
});

test('Vua Tiếng Việt: thưởng nhanh và giảm thưởng khi dùng gợi ý', async () => {
    const { activeVuaGames } = vua._internal;
    const mk = (hintUsed, ago) => ({
        difficulty: 'de', originalWord: 'GIANG HỒ', scrambledLetters: 'x', structure: '2 tiếng', hint: 'h',
        hintUsed, usedWords: ['GIANG HỒ'], authorId: 'u0', consecutiveTimeouts: 0, timer: null,
        solving: false, askedAt: Date.now() - ago,
    });
    const fast = mk(false, 5_000);
    activeVuaGames.set('v2', fast);
    await vuaHandler(fakeMessage('v2', 'u1', 'giang hồ'));
    clearTimeout(fast.timer);
    assert.equal(ledger.at(-1).d, 65);

    const hinted = mk(true, 5_000);
    activeVuaGames.set('v3', hinted);
    await vuaHandler(fakeMessage('v3', 'u1', 'giang hồ'));
    clearTimeout(hinted.timer);
    assert.equal(ledger.at(-1).d, 50);
});

test('Một kênh không chạy đồng thời Nối Từ và Vua Tiếng Việt', async () => {
    const { claimChannel } = require('../src/shared/channelGames');
    assert.equal(claimChannel('cx', 'noitu'), null);
    assert.equal(claimChannel('cx', 'vuatiengviet'), 'noitu');
    releaseChannel('cx', 'noitu');
});

test('Nối Từ: chuỗi thắng cộng thưởng (+30/bậc), sai từ thì đứt chuỗi, kỷ lục được ghi', async () => {
    openGame('s1', 'Tu Tiên');
    for (const w of ['tiên giới', 'giới hạn', 'hạn chế']) await handler(fakeMessage('s1', 'u1', w));
    assert.deepEqual(ledger.map((l) => l.d), [50, 80, 110]);
    assert.equal(bests['u1:stats.noituBestStreak'], 3);

    aiVerdict = { valid: false, reason: 'vô nghĩa' };
    await handler(fakeMessage('s1', 'u1', 'chế tạp'));                 // sai → đứt chuỗi
    aiVerdict = { valid: true, reason: 'ok' };
    await handler(fakeMessage('s1', 'u1', 'chế độ'));
    assert.equal(ledger.at(-1).d, 50);
});

test('Vua Tiếng Việt: cùng người thắng liên tiếp được thưởng chuỗi, người khác thắng xen vào thì đứt', async () => {
    const { activeVuaGames } = vua._internal;
    const game = {
        difficulty: 'de', originalWord: 'HOÀNG HÔN', scrambledLetters: 'x', structure: '2 tiếng', hint: 'h',
        hintUsed: false, streak: 0, streakUserId: null, usedWords: ['HOÀNG HÔN'], authorId: 'u0',
        consecutiveTimeouts: 0, timer: null, solving: false, askedAt: Date.now() - 40_000,
    };
    activeVuaGames.set('streak1', game);
    const answers = [['u1', 'hoàng hôn'], ['u1', 'bình minh'], ['u2', 'giang hồ']];
    for (const [uid, text] of answers) {
        game.askedAt = Date.now() - 40_000;
        await vuaHandler(fakeMessage('streak1', uid, text));
        clearTimeout(game.timer);
        game.solving = false;
    }
    assert.deepEqual(ledger.map((l) => l.d), [50, 80, 50]);
    assert.equal(bests['u1:stats.vuatiengvietBestStreak'], 2);
});
