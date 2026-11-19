// Poker: bộ bài & chấm điểm tay bài Texas Hold'em (chuẩn, có so lá phụ)

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const CATEGORY_NAMES = [
    'Mậu Thầu',          // 0 High card
    'Một Đôi',           // 1
    'Hai Đôi',           // 2
    'Sám Cô',            // 3
    'Sảnh',              // 4
    'Thùng',             // 5
    'Cù Lũ',             // 6
    'Tứ Quý',            // 7
    'Thùng Phá Sảnh',    // 8
];

function makeCard(value, suit) {
    const rank = RANKS[value - 2];
    return { rank, suit, value, toString: () => `${rank}${suit}` };
}

function createDeck(rng = Math.random) {
    const deck = [];
    for (const suit of SUITS) {
        for (let v = 2; v <= 14; v++) deck.push(makeCard(v, suit));
    }
    return shuffle(deck, rng);
}

function shuffle(array, rng = Math.random) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Lá cao nhất của sảnh trong tập giá trị (đã unique), 0 nếu không có. Hỗ trợ A-2-3-4-5. */
function straightHigh(values) {
    const set = new Set(values);
    if (set.has(14)) set.add(1);
    for (let hi = 14; hi >= 5; hi--) {
        let ok = true;
        for (let k = 0; k < 5; k++) if (!set.has(hi - k)) { ok = false; break; }
        if (ok) return hi;
    }
    return 0;
}

/** Mã hóa [category, ...tiebreakers] thành 1 số để so sánh trực tiếp. */
function encode(category, kickers) {
    let score = category;
    for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] || 0);
    return score;
}

/**
 * Chấm tay bài tốt nhất từ 5–7 lá.
 * @returns {{ category:number, rankName:string, score:number }}
 */
function evaluate7Cards(cards) {
    const counts = new Map();
    const bySuit = new Map();
    for (const c of cards) {
        counts.set(c.value, (counts.get(c.value) || 0) + 1);
        if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
        bySuit.get(c.suit).push(c.value);
    }

    const result = (category, kickers) => ({
        category,
        rankName: CATEGORY_NAMES[category],
        score: encode(category, kickers),
    });

    // Thùng / Thùng phá sảnh
    let flushValues = null;
    for (const vals of bySuit.values()) {
        if (vals.length >= 5) flushValues = [...vals].sort((a, b) => b - a);
    }
    if (flushValues) {
        const sf = straightHigh(flushValues);
        if (sf) return result(8, [sf]);
    }

    // Nhóm theo (số lượng desc, giá trị desc)
    const groups = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || b.value - a.value);
    const uniqueDesc = [...counts.keys()].sort((a, b) => b - a);
    const kickersExcept = (exclude, n) => uniqueDesc.filter((v) => !exclude.includes(v)).slice(0, n);

    if (groups[0].count === 4) {
        return result(7, [groups[0].value, ...kickersExcept([groups[0].value], 1)]);
    }
    if (groups[0].count === 3) {
        const pairPart = groups.slice(1).find((g) => g.count >= 2);
        if (pairPart) return result(6, [groups[0].value, pairPart.value]);
    }
    if (flushValues) return result(5, flushValues.slice(0, 5));

    const st = straightHigh(uniqueDesc);
    if (st) return result(4, [st]);

    if (groups[0].count === 3) {
        return result(3, [groups[0].value, ...kickersExcept([groups[0].value], 2)]);
    }
    if (groups[0].count === 2 && groups[1]?.count === 2) {
        const hi = groups[0].value;
        const lo = groups[1].value;
        return result(2, [hi, lo, ...kickersExcept([hi, lo], 1)]);
    }
    if (groups[0].count === 2) {
        return result(1, [groups[0].value, ...kickersExcept([groups[0].value], 3)]);
    }
    return result(0, uniqueDesc.slice(0, 5));
}

module.exports = {
    SUITS,
    RANKS,
    CATEGORY_NAMES,
    makeCard,
    createDeck,
    shuffle,
    evaluate7Cards,
};
