const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mock = (rel, exports) => {
    const p = path.join(__dirname, rel);
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
};

// ── DB giả ──
const ledger = [];
mock('../src/shared/models/UserProfile.js', {
    getOrCreate: async (userId) => ({
        incLinhThach: async (d, opts) => { ledger.push({ userId, d, inc: opts?.inc }); },
    }),
});
mock('../src/shared/utils/nameHelper.js', { getDisplayName: (i) => i.user?.name || 'Đạo hữu' });

const engine = require('../src/features/game-thongminh/quizEngine');
const quiz = require('../src/features/game-thongminh');

// ───────────── Ngân hàng & engine ─────────────

test('ngân hàng 200 câu hợp lệ: 4 đáp án, đáp án đúng nằm trong lựa chọn, không trùng id', () => {
    const { questions, skipped } = engine.loadBank();
    assert.equal(skipped.length, 0);
    assert.equal(questions.length, 200);
    for (const q of questions) {
        assert.equal(q.options.length, 4, q.id);
        assert.ok(q.options.some((o) => o.id === q.correctAnswer), q.id);
        assert.ok(engine.CATEGORY_LABELS[q.category], `${q.id}: chủ đề lạ ${q.category}`);
        assert.ok(engine.DIFFICULTY_LABELS[q.difficulty], `${q.id}: độ khó lạ ${q.difficulty}`);
        assert.ok(q.question.length <= 240, `${q.id}: tiêu đề quá dài cho embed`);
    }
});

test('câu hỏi lỗi bị loại: thiếu đáp án đúng, trùng đáp án, quá ít lựa chọn', () => {
    const ok = { id: 'x', question: 'Q?', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A' };
    assert.equal(engine.isValidQuestion(ok), true);
    assert.equal(engine.isValidQuestion({ ...ok, correctAnswer: 'Z' }), false);
    assert.equal(engine.isValidQuestion({ ...ok, options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'A' }] }), false);
    assert.equal(engine.isValidQuestion({ ...ok, options: [{ id: 'A', text: 'a' }] }), false);
    assert.equal(engine.isValidQuestion({ ...ok, question: '  ' }), false);
});

test('buildRound: xáo đáp án nhưng nhãn đúng luôn trỏ tới đáp án đúng', () => {
    const { questions } = engine.loadBank();
    for (const q of questions) {
        const r = engine.buildRound(q);
        const correctText = q.options.find((o) => o.id === q.correctAnswer).text.trim();
        assert.equal(r.options.find((o) => o.letter === r.correctLetter).text, correctText);
        assert.deepEqual(r.options.map((o) => o.letter), ['A', 'B', 'C', 'D']);
        assert.equal(r.options.filter((o) => o.correct).length, 1);
    }
});

test('createDeck: không lặp câu cho tới khi hết bộ, rồi xáo lại', () => {
    const qs = Array.from({ length: 7 }, (_, i) => ({ id: i }));
    const deck = engine.createDeck(qs);
    const first = Array.from({ length: 7 }, () => deck.next().id);
    assert.equal(new Set(first).size, 7);
    const second = Array.from({ length: 7 }, () => deck.next().id);
    assert.equal(new Set(second).size, 7);
    assert.notEqual(second[0], first[6], 'không trùng liền kề giữa hai vòng');
});

test('filterQuestions lọc theo độ khó và chủ đề', () => {
    const { questions } = engine.loadBank();
    const hard = engine.filterQuestions(questions, { difficulty: 'hard' });
    assert.equal(hard.length, 50);
    assert.ok(hard.every((q) => q.difficulty === 'hard'));
    assert.equal(engine.filterQuestions(questions, { difficulty: 'all', category: 'all' }).length, 200);
    assert.equal(engine.filterQuestions(questions, { category: 'mon_phai_va_loi_choi' }).length, 25);
});

test('gradeRound đếm lựa chọn và danh sách người đúng', () => {
    const question = { id: 'q', question: 'Q', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A' };
    const round = engine.buildRound(question, () => 0.99);
    const correct = round.correctLetter;
    const wrong = round.options.find((o) => !o.correct).letter;
    const g = engine.gradeRound(round, new Map([
        ['u1', { letter: correct, name: 'A' }],
        ['u2', { letter: wrong, name: 'B' }],
        ['u3', { letter: correct, name: 'C' }],
    ]));
    assert.equal(g.answered, 3);
    assert.deepEqual(g.winners.map((w) => w.userId), ['u1', 'u3']);
    assert.equal(g.counts[correct], 2);
});

// ───────────── Luồng game ─────────────

function fakeChannel(id) {
    const sent = [];
    return {
        id,
        sent,
        send: async (payload) => {
            const msg = { payload, edits: [], edit: async (p) => { msg.edits.push(p); msg.payload = p; } };
            sent.push(msg);
            return msg;
        },
    };
}

function startInteraction(channel, opts = {}) {
    const replies = [];
    return {
        replies,
        channelId: channel.id,
        channel,
        user: { id: 'host', name: 'Chủ Trận' },
        options: {
            getInteger: () => opts.thoigian ?? null,
            getString: (k) => opts[k] ?? null,
        },
        reply: async (p) => { replies.push(p); },
    };
}

function click(game, userId, letter) {
    const replies = [];
    return {
        replies,
        channelId: game.channelId,
        customId: `tm:${game.channelId}:${game.round.id}:${letter}`,
        user: { id: userId, name: `U-${userId}` },
        reply: async (p) => { replies.push(p); },
    };
}

async function stopGame(channel) {
    const replies = [];
    await quiz.commands[1].execute({
        channelId: channel.id, user: { id: 'host', name: 'Chủ Trận' }, memberPermissions: null,
        deferReply: async () => {}, editReply: async (p) => { replies.push(p); },
        reply: async (p) => { replies.push(p); },
    });
    return replies;
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

test('luồng game: ra đề → mọi người chọn 1 lần → công bố → +100💎 cho người đúng', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    ledger.length = 0;
    const channel = fakeChannel('room-1');
    await quiz.commands[0].execute(startInteraction(channel));
    const game = quiz._internal.games.get('room-1');
    assert.ok(game);
    assert.equal(game.answerSeconds, 12);

    t.mock.timers.tick(4000); await flush();            // hết lời dẫn → câu 1
    assert.equal(channel.sent.length, 1);
    const qMsg = channel.sent[0];
    assert.equal(qMsg.payload.components[0].components.length, 4);

    const correct = game.round.correctLetter;
    const wrong = game.round.options.find((o) => !o.correct).letter;
    const c1 = click(game, 'u1', correct); await quiz.interactions.tm(c1);
    const c2 = click(game, 'u2', wrong); await quiz.interactions.tm(c2);
    const c1again = click(game, 'u1', wrong); await quiz.interactions.tm(c1again); // không đổi được
    const c3 = click(game, 'u3', correct); await quiz.interactions.tm(c3);
    assert.match(c1.replies[0].content, /Đã ghi nhận/);
    assert.match(c1again.replies[0].content, /không đổi được/);
    assert.equal(game.round.answers.size, 3);

    t.mock.timers.tick(12000); await flush();           // hết 12s → công bố
    assert.equal(qMsg.edits.length, 1);
    const reveal = qMsg.edits[0];
    assert.match(reveal.embeds[0].data.description, new RegExp(`Đáp án đúng: ${correct}\\.`));
    assert.ok(reveal.components[0].components.every((b) => b.data.disabled));
    const rewards = ledger.filter((l) => l.d === 100).map((l) => l.userId).sort();
    assert.deepEqual(rewards, ['u1', 'u3']);
    assert.equal(ledger.find((l) => l.userId === 'u2').d, 0);

    const late = click(game, 'u4', correct); await quiz.interactions.tm(late); // đã đóng → từ chối
    assert.match(late.replies[0].content, /khép lại/);

    t.mock.timers.tick(4000); await flush();            // câu 2 xuất hiện
    assert.equal(channel.sent.length, 2);
    await stopGame(channel);
});

test('5 lượt liên tiếp không ai trả lời thì dừng; có người trả lời thì đếm lại từ đầu', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    ledger.length = 0;
    const channel = fakeChannel('room-2');
    await quiz.commands[0].execute(startInteraction(channel, { thoigian: 5 }));
    const game = quiz._internal.games.get('room-2');
    t.mock.timers.tick(4000); await flush();

    // 2 lượt trống, rồi có người trả lời → bộ đếm về 0
    for (let i = 0; i < 2; i++) { t.mock.timers.tick(5000); await flush(); t.mock.timers.tick(4000); await flush(); }
    assert.equal(game.emptyRounds, 2);
    await quiz.interactions.tm(click(game, 'u1', 'A'));
    t.mock.timers.tick(5000); await flush();
    assert.equal(game.emptyRounds, 0);

    // 5 lượt trống liên tiếp → dừng
    for (let i = 0; i < 5; i++) {
        t.mock.timers.tick(4000); await flush();
        t.mock.timers.tick(5000); await flush();
    }
    assert.equal(quiz._internal.games.has('room-2'), false);
    const last = channel.sent.at(-1).payload;
    assert.match(last.embeds[0].data.title, /THU ĐỀ/);
    assert.match(last.embeds[0].data.description, /5 lượt liên tiếp/);

    // khởi động lại bằng lệnh
    await quiz.commands[0].execute(startInteraction(channel));
    assert.ok(quiz._internal.games.has('room-2'));
    await stopGame(channel);
});

test('không mở hai trận cùng kênh; tuỳ chọn thời gian/độ khó được áp dụng', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const channel = fakeChannel('room-3');
    await quiz.commands[0].execute(startInteraction(channel, { thoigian: 12, dokho: 'expert' }));
    const game = quiz._internal.games.get('room-3');
    assert.equal(game.answerSeconds, 12);
    t.mock.timers.tick(4000); await flush();
    assert.equal(game.round.question.difficulty, 'expert');

    const i2 = startInteraction(channel);
    await quiz.commands[0].execute(i2);
    assert.match(i2.replies[0].content, /đang có trận/);
    await stopGame(channel);
});
