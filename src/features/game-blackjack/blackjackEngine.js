// Blackjack (Xì Dách) Card Engine

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function createShoe(deckCount = 2) {
    const cards = [];
    for (let d = 0; d < deckCount; d++) {
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                cards.push({ rank, suit });
            }
        }
    }
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

function cardValue(card) {
    if (card.rank === 'A') return 11;
    if (['J', 'Q', 'K'].includes(card.rank)) return 10;
    return parseInt(card.rank, 10);
}

/** Tính điểm tốt nhất của bộ bài (A = 11 hoặc 1) */
function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
        total += cardValue(c);
        if (c.rank === 'A') aces++;
    }
    while (total > 21 && aces > 0) {
        total -= 10;
        aces--;
    }
    // soft = còn ít nhất 1 lá A đang tính 11 điểm
    return { total, soft: aces > 0 };
}

/** Xì Dách: đúng 2 lá đầu gồm A + lá 10 điểm (10/J/Q/K). */
function isBlackjack(cards) {
    return cards.length === 2 && handValue(cards).total === 21;
}

/** Xì Bàn: 2 lá đầu đều là A — mạnh hơn Xì Dách. */
function isXiBan(cards) {
    return cards.length === 2 && cards[0].rank === 'A' && cards[1].rank === 'A';
}

/** Ngũ Linh: 5 lá mà tổng điểm vẫn không quá 21. */
function isNguLinh(cards) {
    return cards.length >= 5 && handValue(cards).total <= 21;
}

/**
 * Bậc của tay bài (cao thắng thấp, cùng bậc đặc biệt thì hòa):
 * 4 Xì Bàn › 3 Xì Dách › 2 Ngũ Linh › 0 bài thường (so điểm).
 */
function handTier(cards) {
    if (isXiBan(cards)) return 4;
    if (isBlackjack(cards)) return 3;
    if (isNguLinh(cards)) return 2;
    return 0;
}

function formatCard(card) {
    return `${card.rank}${card.suit}`;
}

function formatHand(cards, hideSecond = false) {
    return cards.map((c, i) => (hideSecond && i === 1 ? '🂠' : formatCard(c))).join('  ');
}

/** Nhà cái rút đến khi đạt từ 17 điểm trở lên (dừng ở soft 17) */
function dealerPlay(dealerCards, shoe) {
    while (handValue(dealerCards).total < 17) {
        dealerCards.push(shoe.pop());
    }
    return dealerCards;
}

/**
 * So kết quả một tay bài với nhà cái.
 * Hệ số lời/lỗ trên mức cược: 2 (Xì Bàn, Ngũ Linh), 1.5 (Xì Dách), 1 (thắng), 0 (hòa), -1 (thua)
 */
const TIER_PAYOUT = { 4: { result: 'xiban', multiplier: 2 }, 3: { result: 'blackjack', multiplier: 1.5 }, 2: { result: 'ngulinh', multiplier: 2 } };

function settleHand(playerCards, dealerCards) {
    const p = handValue(playerCards).total;
    const d = handValue(dealerCards).total;
    const pTier = handTier(playerCards);
    const dTier = handTier(dealerCards);

    if (p > 21) return { result: 'bust', multiplier: -1 };
    if (pTier || dTier) {
        if (pTier === dTier) return { result: 'push', multiplier: 0 };
        if (pTier > dTier) return { ...TIER_PAYOUT[pTier] };
        return { result: 'lose', multiplier: -1 };
    }
    if (d > 21) return { result: 'win', multiplier: 1 };
    if (p > d) return { result: 'win', multiplier: 1 };
    if (p === d) return { result: 'push', multiplier: 0 };
    return { result: 'lose', multiplier: -1 };
}

module.exports = { createShoe, handValue, isBlackjack, isXiBan, isNguLinh, handTier, formatCard, formatHand, dealerPlay, settleHand };
