// Poker Card & Hand Evaluator

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (let i = 0; i < RANKS.length; i++) {
            deck.push({
                rank: RANKS[i],
                suit: suit,
                value: i + 2, // 2 = 2, ..., A = 14
                toString: () => `${RANKS[i]}${suit}`
            });
        }
    }
    return shuffle(deck);
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Đánh giá điểm mạnh bộ 7 lá (2 trên tay + 5 lá chung)
 */
function evaluate7Cards(cards) {
    // Basic scoring for 5-7 card hands
    // Returns { rankName: string, score: number }
    if (cards.length < 5) {
        return { rankName: 'Lá Bài Cao (High Card)', score: getHighCardScore(cards) };
    }

    const valueCounts = {};
    const suitCounts = {};

    for (const card of cards) {
        valueCounts[card.value] = (valueCounts[card.value] || 0) + 1;
        suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    }

    const valuesSorted = Object.keys(valueCounts).map(Number).sort((a, b) => b - a);
    const flushSuit = Object.keys(suitCounts).find(s => suitCounts[s] >= 5);

    // Check Flush & Straight Flush
    let isFlush = !!flushSuit;
    let flushCards = isFlush ? cards.filter(c => c.suit === flushSuit) : [];

    // Pairs & Sets
    const countsSorted = Object.entries(valueCounts)
        .map(([val, count]) => ({ val: Number(val), count }))
        .sort((a, b) => b.count - a.count || b.val - a.val);

    // Four of a kind
    if (countsSorted[0].count === 4) {
        return { rankName: 'Tứ Quý (Four of a Kind)', score: 8000 + countsSorted[0].val };
    }

    // Full House (3 + 2)
    if (countsSorted[0].count === 3 && countsSorted[1]?.count >= 2) {
        return { rankName: 'Cù Lũ (Full House)', score: 7000 + countsSorted[0].val * 10 + countsSorted[1].val };
    }

    // Flush
    if (isFlush) {
        const topFlushVal = flushCards.sort((a, b) => b.value - a.value)[0].value;
        return { rankName: 'Thùng (Flush)', score: 6000 + topFlushVal };
    }

    // Straight (Sảnh)
    const straightVal = checkStraight(valuesSorted);
    if (straightVal) {
        return { rankName: 'Sảnh (Straight)', score: 5000 + straightVal };
    }

    // Three of a kind
    if (countsSorted[0].count === 3) {
        return { rankName: 'Sám Cô (Three of a Kind)', score: 4000 + countsSorted[0].val };
    }

    // Two Pair
    if (countsSorted[0].count === 2 && countsSorted[1]?.count === 2) {
        return { rankName: 'Hai Đôi (Two Pair)', score: 3000 + countsSorted[0].val * 10 + countsSorted[1].val };
    }

    // One Pair
    if (countsSorted[0].count === 2) {
        return { rankName: 'Một Đôi (One Pair)', score: 2000 + countsSorted[0].val };
    }

    // High Card
    return { rankName: `Mậu Thần (${RANKS[cards.sort((a,b)=>b.value-a.value)[0].value - 2]})`, score: 1000 + cards[0].value };
}

function checkStraight(uniqueDescValues) {
    if (uniqueDescValues.length < 5) return 0;
    for (let i = 0; i <= uniqueDescValues.length - 5; i++) {
        if (uniqueDescValues[i] - uniqueDescValues[i + 4] === 4) {
            return uniqueDescValues[i];
        }
    }
    // Check A-2-3-4-5
    if (uniqueDescValues.includes(14) && uniqueDescValues.includes(5) && uniqueDescValues.includes(4) && uniqueDescValues.includes(3) && uniqueDescValues.includes(2)) {
        return 5;
    }
    return 0;
}

function getHighCardScore(cards) {
    return Math.max(...cards.map(c => c.value));
}

module.exports = {
    createDeck,
    evaluate7Cards
};
