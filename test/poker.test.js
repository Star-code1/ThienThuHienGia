const test = require('node:test');
const assert = require('node:assert');
const { makeCard, evaluate7Cards } = require('../src/features/game-poker/pokerEngine');
const T = require('../src/features/game-poker/pokerTable');

const V = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const S = { s: '♠️', h: '♥️', d: '♦️', c: '♣️' };
const cards = (str) => str.split(' ').map((t) => makeCard(V[t.slice(0, -1)] || Number(t.slice(0, -1)), S[t.slice(-1)]));
const ev = (str) => evaluate7Cards(cards(str));

test('nhận diện đúng loại bài', () => {
    assert.strictEqual(ev('9h Th Jh Qh Kh 2c 3d').rankName, 'Thùng Phá Sảnh');
    assert.strictEqual(ev('As 2s 3s 4s 5s Kd Kc').rankName, 'Thùng Phá Sảnh');
    assert.strictEqual(ev('7s 7h 7d 7c 2s 3h 9d').rankName, 'Tứ Quý');
    assert.strictEqual(ev('7s 7h 7d 2c 2s 3h 9d').rankName, 'Cù Lũ');
    assert.strictEqual(ev('7s 7h 7d 2c 2s 2h 9d').rankName, 'Cù Lũ');
    assert.strictEqual(ev('2h 5h 9h Jh Kh 3c 4d').rankName, 'Thùng');
    assert.strictEqual(ev('As 2d 3c 4h 5s 9d Kc').rankName, 'Sảnh');
    assert.strictEqual(ev('8s 8h 8d 2c 5s Jh Kd').rankName, 'Sám Cô');
    assert.strictEqual(ev('8s 8h 5d 5c 2s Jh Kd').rankName, 'Hai Đôi');
    assert.strictEqual(ev('8s 8h 4d 5c 2s Jh Kd').rankName, 'Một Đôi');
    assert.strictEqual(ev('8s 9h 4d 5c 2s Jh Kd').rankName, 'Mậu Thầu');
});

test('so lá phụ (kicker) và thứ tự loại bài', () => {
    assert.ok(ev('As Ad Kc 7h 4s 3d 2c').score > ev('Ah Ac Qc 7h 4s 3d 2c').score);
    assert.ok(ev('6s 7d 8c 9h Ts 2d 2c').score > ev('As 2d 3c 4h 5s 9d 9c').score); // sảnh 10 > sảnh 5
    assert.ok(ev('9h Th Jh Qh Kh 2c 3d').score > ev('7s 7h 7d 7c 2s 3h 9d').score);
    assert.strictEqual(ev('As Kd 9c 7h 4s 3d 2c').score, ev('Ah Kc 9d 7s 4h 3c 2d').score);
});

test('chia pot phụ khi có all-in', () => {
    const players = [
        { id: 'a', total: 100, folded: false }, // all-in ngắn, bài mạnh nhất
        { id: 'b', total: 300, folded: false }, // bài nhì
        { id: 'c', total: 300, folded: false }, // bài kém
        { id: 'd', total: 50, folded: true },
    ];
    const score = { a: 3, b: 2, c: 1, d: 9 };
    const pay = T.computePayouts(players, (p) => score[p.id]);
    assert.strictEqual(pay.get('a'), 350); // 100×3 + 50 của d
    assert.strictEqual(pay.get('b'), 400); // pot phụ 200×2
    assert.strictEqual(pay.get('c'), 0);
    assert.strictEqual(pay.get('d'), 0);
});

test('hòa thì chia đều pot', () => {
    const players = [{ id: 'a', total: 100, folded: false }, { id: 'b', total: 100, folded: false }];
    const pay = T.computePayouts(players, () => 5);
    assert.strictEqual(pay.get('a'), 100);
    assert.strictEqual(pay.get('b'), 100);
});

function newTable(n = 3) {
    const t = T.createTable({ id: 't', mode: 'chung', bet: 100, hostId: 'p0' });
    for (let i = 0; i < n; i++) T.addPlayer(t, { id: `p${i}`, name: `P${i}`, stack: 5000 });
    return t;
}

test('theo (call) và xem (check) đi hết các vòng tới lật bài', () => {
    const t = newTable(3);
    assert.strictEqual(T.startHand(t), null);
    assert.strictEqual(T.pot(t), 300);
    let guard = 0;
    while (t.stage !== 'lobby' && guard++ < 50) {
        const who = t.players[t.toAct].id;
        assert.strictEqual(T.act(t, who, 'call'), null);
    }
    assert.ok(t.lastResult.showdown);
    assert.strictEqual(t.lastResult.board.length, 5);
    const totalStack = t.players.reduce((s, p) => s + p.stack, 0);
    assert.strictEqual(totalStack, 15000); // bảo toàn Linh Thạch
});

test('tố → người khác phải theo, bỏ bài thì người còn lại ăn pot', () => {
    const t = newTable(2);
    T.startHand(t);
    const first = t.players[t.toAct];
    T.act(t, first.id, 'raise');
    assert.strictEqual(t.currentBet, 100);
    const second = t.players[t.toAct];
    assert.notStrictEqual(second.id, first.id);
    assert.strictEqual(T.legalActions(t).toCall, 100);
    T.act(t, second.id, 'fold');
    assert.strictEqual(t.stage, 'lobby');
    assert.strictEqual(t.lastResult.showdown, false);
    const winner = t.lastResult.rows.find((r) => r.id === first.id);
    assert.strictEqual(winner.net, 100);
});

test('không đúng lượt thì bị từ chối', () => {
    const t = newTable(2);
    T.startHand(t);
    const other = t.players.find((p, i) => i !== t.toAct);
    assert.match(T.act(t, other.id, 'call'), /lượt/);
});

test('all-in khi thiếu tiền và chạy hết bài', () => {
    const t = T.createTable({ id: 't', mode: 'chung', bet: 100, hostId: 'a' });
    T.addPlayer(t, { id: 'a', name: 'A', stack: 150 });
    T.addPlayer(t, { id: 'b', name: 'B', stack: 5000 });
    T.startHand(t);
    let guard = 0;
    while (t.stage !== 'lobby' && guard++ < 50) T.act(t, t.players[t.toAct].id, T.legalActions(t).canRaise ? 'raise' : 'call');
    assert.strictEqual(t.lastResult.board.length, 5);
    assert.strictEqual(t.players.reduce((s, p) => s + p.stack, 0), 5150);
});

test('máy tự đánh tới khi hết ván, không treo', () => {
    for (let r = 0; r < 20; r++) {
        const t = T.createTable({ id: 't', mode: 'solo', bet: 100, hostId: 'h' });
        T.addPlayer(t, { id: 'b1', name: 'B1', stack: 3000, isBot: true });
        T.addPlayer(t, { id: 'b2', name: 'B2', stack: 3000, isBot: true });
        T.addPlayer(t, { id: 'b3', name: 'B3', stack: 3000, isBot: true });
        T.startHand(t);
        T.runBots(t);
        assert.strictEqual(t.stage, 'lobby');
        assert.strictEqual(t.players.reduce((s, p) => s + p.stack, 0), 9000);
    }
});

test('All-in: dồn hết chip, tố vượt thì mở lại lượt, đủ pot phụ và bảo toàn tiền', () => {
    for (let r = 0; r < 30; r++) {
        const t = T.createTable({ id: 't', mode: 'chung', bet: 100, hostId: 'a' });
        T.addPlayer(t, { id: 'a', name: 'A', stack: 1000 });
        T.addPlayer(t, { id: 'b', name: 'B', stack: 400 });
        T.addPlayer(t, { id: 'c', name: 'C', stack: 5000 });
        T.startHand(t);
        const first = t.players[t.toAct];
        const legal = T.legalActions(t);
        assert.ok(legal.canAllIn);
        assert.strictEqual(legal.allInTo, first.bet + first.stack);
        assert.strictEqual(T.act(t, first.id, 'allin'), null);
        assert.strictEqual(first.allIn, true);
        assert.strictEqual(first.stack, 0);
        let guard = 0;
        while (t.stage !== 'lobby' && guard++ < 60) {
            const p = t.players[t.toAct];
            const l = T.legalActions(t);
            assert.strictEqual(T.act(t, p.id, l.canCheck ? 'check' : (guard % 3 === 0 ? 'allin' : 'call')), null);
        }
        assert.strictEqual(t.stage, 'lobby');
        assert.strictEqual(t.players.reduce((s, p) => s + p.stack, 0), 6400);
    }
});

test('All-in bị từ chối khi hết chip, và tố All-in ngắn hơn mức cược chỉ tính là theo', () => {
    const t = T.createTable({ id: 't', mode: 'chung', bet: 100, hostId: 'a' });
    T.addPlayer(t, { id: 'a', name: 'A', stack: 5000 });
    T.addPlayer(t, { id: 'b', name: 'B', stack: 130 });
    T.startHand(t); // b còn 30 chip sau ante
    const order = [t.players[t.toAct]];
    if (order[0].id === 'a') {
        T.act(t, 'a', 'raise');
        assert.strictEqual(T.act(t, 'b', 'allin'), null); // 30 < 100 phải theo → chỉ theo All-in
        assert.strictEqual(t.players[1].allIn, true);
        assert.strictEqual(t.currentBet, 100);
    } else {
        assert.strictEqual(T.act(t, 'b', 'allin'), null);
        assert.strictEqual(t.players[1].stack, 0);
        assert.match(T.act(t, 'b', 'allin') || '', /lượt|bắt đầu|kết thúc|hết chip/);
    }
});
