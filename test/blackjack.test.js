const test = require('node:test');
const assert = require('node:assert');
const { createShoe, handValue, isBlackjack, dealerPlay, settleHand } = require('../src/features/game-blackjack/blackjackEngine');

// "A♠ K♥ 7♦" → [{rank, suit}]
const hand = (str) => str.split(' ').map((t) => ({ rank: t.slice(0, -1), suit: t.slice(-1) }));

test('bộ bài 2 bộ có 104 lá, mỗi lá xuất hiện đúng 2 lần', () => {
    const shoe = createShoe(2);
    assert.strictEqual(shoe.length, 104);
    const counts = new Map();
    for (const c of shoe) counts.set(c.rank + c.suit, (counts.get(c.rank + c.suit) || 0) + 1);
    assert.strictEqual(counts.size, 52);
    assert.ok([...counts.values()].every((n) => n === 2));
});

test('tính điểm: A linh hoạt 11/1, J/Q/K = 10', () => {
    assert.deepStrictEqual(handValue(hand('A♠ 6♥')), { total: 17, soft: true });
    assert.deepStrictEqual(handValue(hand('A♠ 6♥ 9♦')), { total: 16, soft: false });
    assert.deepStrictEqual(handValue(hand('A♠ A♥ 9♦')), { total: 21, soft: true });
    assert.deepStrictEqual(handValue(hand('A♠ A♥ A♦ A♣')), { total: 14, soft: true });
    assert.strictEqual(handValue(hand('K♠ Q♥ 2♦')).total, 22);
});

test('Xì Dách chỉ tính với 2 lá đầu', () => {
    assert.ok(isBlackjack(hand('A♠ K♥')));
    assert.ok(isBlackjack(hand('10♠ A♥')));
    assert.ok(!isBlackjack(hand('7♠ 7♥ 7♦')));
});

test('nhà cái rút tới khi đạt ít nhất 17', () => {
    const dealer = hand('10♠ 6♥');
    const shoe = hand('9♣ 5♦'); // pop() lấy lá cuối: 5♦
    dealerPlay(dealer, shoe);
    assert.strictEqual(handValue(dealer).total, 21);

    const stands = hand('10♠ 7♥');
    dealerPlay(stands, hand('5♦'));
    assert.strictEqual(stands.length, 2);
});

test('so kết quả với nhà cái', () => {
    const r = (p, d) => settleHand(hand(p), hand(d));
    assert.deepStrictEqual(r('A♠ K♥', '10♠ 9♥'), { result: 'blackjack', multiplier: 1.5 });
    assert.deepStrictEqual(r('A♠ K♥', 'A♦ Q♣'), { result: 'push', multiplier: 0 });
    assert.deepStrictEqual(r('10♠ 9♥', 'A♦ Q♣'), { result: 'lose', multiplier: -1 });
    assert.deepStrictEqual(r('10♠ 9♥ 5♦', '10♦ 7♣'), { result: 'bust', multiplier: -1 });
    assert.deepStrictEqual(r('10♠ 8♥', '10♦ 6♣ 9♠'), { result: 'win', multiplier: 1 });
    assert.deepStrictEqual(r('10♠ 8♥', '10♦ 7♣'), { result: 'win', multiplier: 1 });
    assert.deepStrictEqual(r('10♠ 7♥', '10♦ 7♣'), { result: 'push', multiplier: 0 });
    assert.deepStrictEqual(r('10♠ 6♥', '10♦ 7♣'), { result: 'lose', multiplier: -1 });
    // Người chơi quắc thua ngay cả khi nhà cái cũng quắc
    assert.deepStrictEqual(r('10♠ 6♥ 9♦', '10♦ 6♣ 9♠'), { result: 'bust', multiplier: -1 });
});

test('Xì Bàn, Xì Dách, Ngũ Linh: thứ tự bậc và hệ số trả thưởng', () => {
    const { handTier, isXiBan, isNguLinh } = require('../src/features/game-blackjack/blackjackEngine');
    const r = (p, d) => settleHand(hand(p), hand(d));
    assert.ok(isXiBan(hand('A♠ A♥')));
    assert.ok(!isXiBan(hand('A♠ A♥ 9♦')));
    assert.ok(isNguLinh(hand('2♠ 3♥ 4♦ 5♣ 2♥')));
    assert.ok(!isNguLinh(hand('10♠ 3♥ 4♦ 5♣ 2♥'))); // 24 điểm: quắc
    assert.strictEqual(handTier(hand('A♠ K♥')), 3);
    assert.deepStrictEqual(r('A♠ A♥', '10♠ 9♥'), { result: 'xiban', multiplier: 2 });
    assert.deepStrictEqual(r('A♠ A♥', 'A♦ Q♣'), { result: 'xiban', multiplier: 2 });   // Xì Bàn thắng Xì Dách
    assert.deepStrictEqual(r('A♠ K♥', 'A♦ A♣'), { result: 'lose', multiplier: -1 });   // Xì Dách thua Xì Bàn
    assert.deepStrictEqual(r('A♠ A♥', 'A♦ A♣'), { result: 'push', multiplier: 0 });
    assert.deepStrictEqual(r('2♠ 3♥ 4♦ 5♣ 2♥', '10♦ 10♣'), { result: 'ngulinh', multiplier: 2 });
    assert.deepStrictEqual(r('2♠ 3♥ 4♦ 5♣ 2♥', 'A♦ K♣'), { result: 'lose', multiplier: -1 }); // thua Xì Dách
    assert.deepStrictEqual(r('2♠ 3♥ 4♦ 5♣ 2♥', '2♦ 3♣ 4♠ 5♥ 2♣'), { result: 'push', multiplier: 0 });
    assert.deepStrictEqual(r('10♠ 10♥', '2♦ 3♣ 4♠ 5♥ 2♣'), { result: 'lose', multiplier: -1 }); // nhà cái Ngũ Linh
});
