const test = require('node:test');
const assert = require('node:assert');
const { LINH_THU, rollDice, settleBets, totalOf } = require('../src/features/game-baucua/baucuaEngine');

test('lắc ra đúng 3 linh thú hợp lệ', () => {
    const dice = rollDice();
    assert.strictEqual(dice.length, 3);
    assert.ok(dice.every((d) => LINH_THU.includes(d)));
    // random cố định → kết quả xác định
    assert.deepStrictEqual(rollDice(() => 0).map((d) => d.id), ['bau', 'bau', 'bau']);
    assert.deepStrictEqual(rollDice(() => 0.999).map((d) => d.id), ['nai', 'nai', 'nai']);
});

test('trả thưởng: vốn + cược x số mặt trùng', () => {
    const dice = ['bau', 'bau', 'cua'];
    const r = settleBets({ bau: 100, cua: 50, ga: 200 }, dice);
    assert.strictEqual(r.totalBet, 350);
    // bầu: 100 + 200, cua: 50 + 50, gà: thua
    assert.strictEqual(r.payout, 400);
    assert.strictEqual(r.net, 50);
    assert.deepStrictEqual(r.lines.map((l) => [l.beastId, l.matchCount, l.win]), [
        ['bau', 2, 200], ['cua', 1, 50], ['ga', 0, 0],
    ]);
});

test('trúng cả 3 mặt nhận x3, không trúng thì mất hết', () => {
    assert.deepStrictEqual(
        (({ payout, net }) => ({ payout, net }))(settleBets({ nai: 100 }, ['nai', 'nai', 'nai'])),
        { payout: 400, net: 300 }
    );
    assert.deepStrictEqual(
        (({ payout, net }) => ({ payout, net }))(settleBets({ nai: 100 }, ['bau', 'cua', 'tom'])),
        { payout: 0, net: -100 }
    );
});

test('bỏ qua cược 0/âm và tính tổng cược', () => {
    const r = settleBets({ bau: 0, cua: -5, tom: 10 }, ['tom', 'ca', 'ga']);
    assert.strictEqual(r.totalBet, 10);
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(totalOf({ bau: 100, cua: 250 }), 350);
});
