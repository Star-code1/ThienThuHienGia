const LINH_THU = [
    { id: 'bau', name: 'Bầu (Lô Tháp)', emoji: '🍈' },
    { id: 'cua', name: 'Cua (Kim Quy)', emoji: '🦀' },
    { id: 'tom', name: 'Tôm (Linh Tôm)', emoji: '🦞' },
    { id: 'ca',  name: 'Cá (Thủy Tộc)', emoji: '🐟' },
    { id: 'ga',  name: 'Gà (Hoàng Yến)', emoji: '🐓' },
    { id: 'nai', name: 'Nai (Lộc Thần)', emoji: '🦌' },
];

/** Lắc 3 xúc xắc. `random` có thể truyền vào để test. */
function rollDice(random = Math.random) {
    return [0, 1, 2].map(() => LINH_THU[Math.floor(random() * LINH_THU.length)]);
}

/**
 * Tính thưởng cho cược của một người.
 * Tiền cược đã bị trừ lúc đặt, nên `payout` là số Linh Thạch trả lại (vốn + thưởng) cho các cửa trúng.
 *
 * @param {Object<string, number>} beastBets  { bau: 100, cua: 200, ... }
 * @param {string[]} diceIds                  id của 3 linh thú lắc ra
 * @returns {{ totalBet: number, payout: number, net: number, lines: Array<{beastId, amount, matchCount, win}> }}
 */
function settleBets(beastBets, diceIds) {
    let totalBet = 0;
    let payout = 0;
    const lines = [];

    for (const [beastId, amount] of Object.entries(beastBets)) {
        if (!(amount > 0)) continue;
        totalBet += amount;
        const matchCount = diceIds.filter(id => id === beastId).length;
        const win = amount * matchCount;
        if (matchCount > 0) payout += amount + win; // Hoàn vốn + tiền thắng
        lines.push({ beastId, amount, matchCount, win });
    }

    return { totalBet, payout, net: payout - totalBet, lines };
}

const totalOf = (beastBets) => Object.values(beastBets).reduce((a, b) => a + b, 0);

module.exports = { LINH_THU, rollDice, settleBets, totalOf };
