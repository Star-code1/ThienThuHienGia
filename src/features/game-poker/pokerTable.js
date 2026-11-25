/**
 * Logic bàn Poker Texas Hold'em (Fixed-Limit) — không phụ thuộc Discord để dễ test.
 *
 * Luật rút gọn cho Discord:
 * - Mỗi ván, mọi người đặt "ante" = mức cược của bàn vào pot.
 * - 4 vòng cược: Preflop → Flop → Turn → River. Hành động: Bỏ / Xem / Theo / Tố.
 * - Tố cố định: +1× cược (Preflop, Flop), +2× cược (Turn, River); tối đa 4 lần tố mỗi vòng.
 * - Thiếu tiền để theo → tự động All-in, chia pot phụ (side pot) đúng luật.
 */
const { createDeck, evaluate7Cards, shuffle } = require('./pokerEngine');

const STAGES = ['preflop', 'flop', 'turn', 'river'];
const STAGE_NAMES = { lobby: 'Chờ người chơi', preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Lật bài' };
const MAX_RAISES_PER_ROUND = 4;
const MAX_SEATS = 6;

function createTable({ id, mode, bet, hostId }) {
    return {
        id,
        mode, // 'solo' | 'chung'
        bet,
        hostId,
        players: [],
        stage: 'lobby',
        dealer: -1,
        deck: [],
        board: [],
        currentBet: 0,
        raiseCount: 0,
        toAct: -1,
        log: [],
        lastResult: null,
        handNo: 0,
    };
}

function addPlayer(table, { id, name, stack, isBot = false }) {
    if (table.players.length >= MAX_SEATS) return 'Bàn đã đủ chỗ.';
    if (table.players.some((p) => p.id === id)) return 'Đạo hữu đã ngồi bàn này rồi.';
    table.players.push(newSeat({ id, name, stack, isBot }));
    return null;
}

function newSeat({ id, name, stack, isBot }) {
    return { id, name, stack, isBot, hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false };
}

function removePlayer(table, id) {
    const idx = table.players.findIndex((p) => p.id === id);
    if (idx >= 0) table.players.splice(idx, 1);
}

const pot = (table) => table.players.reduce((s, p) => s + p.total, 0);
const live = (table) => table.players.filter((p) => !p.folded);
const canAct = (p) => !p.folded && !p.allIn;
const raiseSize = (table) => (table.stage === 'turn' || table.stage === 'river' ? 2 : 1) * table.bet;

function pushLog(table, text) {
    table.log.push(text);
    if (table.log.length > 6) table.log.shift();
}

/** Đưa tiền từ stack vào pot (tự all-in nếu thiếu). Trả về số thực trả. */
function commit(p, amount, intoRoundBet = true) {
    const paid = Math.min(amount, p.stack);
    p.stack -= paid;
    p.total += paid;
    if (intoRoundBet) p.bet += paid;
    if (p.stack === 0) p.allIn = true;
    return paid;
}

function nextSeat(table, from, pred) {
    const n = table.players.length;
    for (let k = 1; k <= n; k++) {
        const i = (from + k) % n;
        if (pred(table.players[i])) return i;
    }
    return -1;
}

/** Bắt đầu ván mới. Trả lỗi (string) hoặc null. */
function startHand(table, rng = Math.random) {
    table.players = table.players.filter((p) => p.stack > 0);
    if (table.players.length < 2) return 'Cần ít nhất 2 người (hoặc máy) còn Linh Thạch để bắt đầu.';

    table.handNo += 1;
    table.deck = createDeck(rng);
    table.board = [];
    table.log = [];
    table.lastResult = null;
    table.dealer = (table.dealer + 1) % table.players.length;

    for (const p of table.players) {
        Object.assign(p, { hole: [table.deck.pop(), table.deck.pop()], bet: 0, total: 0, folded: false, allIn: false, acted: false });
        commit(p, table.bet, false); // ante
    }
    pushLog(table, `🪙 Mọi người đặt ante **${table.bet}** 💎`);
    beginRound(table, 'preflop');
    return null;
}

function beginRound(table, stage) {
    table.stage = stage;
    table.currentBet = 0;
    table.raiseCount = 0;
    for (const p of table.players) { p.bet = 0; p.acted = false; }
    if (stage === 'flop') table.board.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
    if (stage === 'turn' || stage === 'river') table.board.push(table.deck.pop());
    table.toAct = nextSeat(table, table.dealer, canAct);
    settleIfNoAction(table);
}

/** Nếu không ai còn phải hành động (≤1 người có thể cược) → chạy tiếp. */
function settleIfNoAction(table) {
    if (live(table).length <= 1) return finishHand(table);
    const actors = table.players.filter(canAct);
    const roundDone = actors.every((p) => p.acted && p.bet === table.currentBet);
    if (actors.length === 0 || (actors.length === 1 && actors[0].bet >= table.currentBet) || roundDone) {
        return advanceStage(table);
    }
    if (table.toAct < 0 || !canAct(table.players[table.toAct])) {
        table.toAct = nextSeat(table, table.toAct < 0 ? table.dealer : table.toAct, canAct);
    }
}

function advanceStage(table) {
    const i = STAGES.indexOf(table.stage);
    if (i === STAGES.length - 1) return finishHand(table);
    beginRound(table, STAGES[i + 1]);
}

/** Các hành động hợp lệ của người đang tới lượt. */
function legalActions(table) {
    const p = table.players[table.toAct];
    if (!p || !STAGES.includes(table.stage)) return null;
    const toCall = Math.max(0, table.currentBet - p.bet);
    const raiseTo = table.currentBet + raiseSize(table);
    return {
        player: p,
        toCall: Math.min(toCall, p.stack),
        canCheck: toCall === 0,
        canRaise: table.raiseCount < MAX_RAISES_PER_ROUND && p.stack > toCall,
        raiseCost: Math.min(raiseTo - p.bet, p.stack),
        canAllIn: p.stack > 0,
        allInTo: p.bet + p.stack, // tổng tiền đã đặt ở vòng này sau khi All-in
    };
}

/**
 * Người chơi hành động. action: 'fold' | 'check' | 'call' | 'raise' | 'allin'.
 * Trả về lỗi (string) hoặc null.
 */
function act(table, playerId, action) {
    const legal = legalActions(table);
    if (!legal) return 'Ván bài chưa bắt đầu hoặc đã kết thúc.';
    const p = legal.player;
    if (p.id !== playerId) return 'Chưa tới lượt của đạo hữu.';

    if (action === 'check' && !legal.canCheck) action = 'call';
    if (action === 'call' && legal.canCheck) action = 'check';
    if (action === 'raise' && !legal.canRaise) return 'Không thể tố thêm ở vòng này.';
    if (action === 'allin' && !legal.canAllIn) return 'Đạo hữu đã hết chip để All-in.';

    switch (action) {
        case 'fold':
            p.folded = true;
            pushLog(table, `🏳️ **${p.name}** bỏ bài`);
            break;
        case 'check':
            pushLog(table, `✋ **${p.name}** xem`);
            break;
        case 'call': {
            const paid = commit(p, legal.toCall);
            pushLog(table, `📥 **${p.name}** theo **${paid}**${p.allIn ? ' (All-in)' : ''}`);
            break;
        }
        case 'raise': {
            commit(p, legal.raiseCost);
            if (p.bet > table.currentBet) {
                table.currentBet = p.bet;
                table.raiseCount += 1;
                for (const o of table.players) if (o !== p && canAct(o)) o.acted = false;
            }
            pushLog(table, `🔥 **${p.name}** tố lên **${p.bet}**${p.allIn ? ' (All-in)' : ''}`);
            break;
        }
        case 'allin': {
            // Dồn hết chip: nếu vượt mức cược hiện tại thì là một cú tố (mở lại lượt cho người khác), không thì là theo All-in
            const paid = commit(p, p.stack);
            if (p.bet > table.currentBet) {
                table.currentBet = p.bet;
                table.raiseCount += 1;
                for (const o of table.players) if (o !== p && canAct(o)) o.acted = false;
                pushLog(table, `💥 **${p.name}** ALL-IN lên **${p.bet}**`);
            } else {
                pushLog(table, `💥 **${p.name}** ALL-IN theo **${paid}**`);
            }
            break;
        }
        default:
            return 'Hành động không hợp lệ.';
    }
    p.acted = true;

    if (live(table).length <= 1) {
        finishHand(table);
        return null;
    }
    const actors = table.players.filter(canAct);
    const roundDone = actors.every((o) => o.acted && o.bet === table.currentBet);
    if (roundDone) {
        advanceStage(table);
    } else {
        table.toAct = nextSeat(table, table.toAct, canAct);
        if (table.toAct < 0) advanceStage(table);
    }
    return null;
}

/** Chia pot (kể cả pot phụ). Trả về Map id -> số tiền nhận. */
function computePayouts(players, scoreOf) {
    const payouts = new Map(players.map((p) => [p.id, 0]));
    const levels = [...new Set(players.filter((p) => !p.folded).map((p) => p.total))].sort((a, b) => a - b);
    let prev = 0;
    for (let li = 0; li < levels.length; li++) {
        const level = levels[li];
        // Tầng cuối gom luôn phần dư của người đã bỏ bài góp nhiều hơn
        const cap = li === levels.length - 1 ? Infinity : level;
        const slice = players.reduce((s, p) => s + Math.max(0, Math.min(p.total, cap) - Math.min(p.total, prev)), 0);
        prev = level;
        if (slice <= 0) continue;
        const eligible = players.filter((p) => !p.folded && p.total >= level);
        const best = Math.max(...eligible.map(scoreOf));
        const winners = eligible.filter((p) => scoreOf(p) === best);
        const share = Math.floor(slice / winners.length);
        winners.forEach((w, i) => payouts.set(w.id, payouts.get(w.id) + share + (i === 0 ? slice - share * winners.length : 0)));
    }
    return payouts;
}

function finishHand(table) {
    const contenders = live(table);
    const showdown = contenders.length > 1;
    if (showdown) while (table.board.length < 5) table.board.push(table.deck.pop());

    const evals = new Map(table.players.map((p) => [p.id, evaluate7Cards([...p.hole, ...table.board])]));
    const payouts = showdown
        ? computePayouts(table.players, (p) => evals.get(p.id).score)
        : new Map(table.players.map((p) => [p.id, p.folded ? 0 : pot(table)]));

    const totalPot = pot(table);
    for (const p of table.players) p.stack += payouts.get(p.id);

    table.lastResult = {
        showdown,
        pot: totalPot,
        board: [...table.board],
        rows: table.players.map((p) => ({
            id: p.id,
            name: p.name,
            isBot: p.isBot,
            hole: [...p.hole],
            folded: p.folded,
            hand: evals.get(p.id).rankName,
            won: payouts.get(p.id),
            net: payouts.get(p.id) - p.total,
        })),
    };
    table.stage = 'lobby';
    table.toAct = -1;
}

// ── Máy chơi ────────────────────────────────────────────────────────────────

/** Ước lượng tỉ lệ thắng bằng Monte Carlo. */
function estimateEquity(table, p, iterations = 250, rng = Math.random) {
    const opponents = live(table).length - 1;
    if (opponents <= 0) return 1;
    const known = new Set([...p.hole, ...table.board].map(String));
    const rest = createDeck(rng).filter((c) => !known.has(String(c)));
    let score = 0;
    for (let it = 0; it < iterations; it++) {
        const d = shuffle(rest, rng);
        let k = 0;
        const board = [...table.board];
        while (board.length < 5) board.push(d[k++]);
        const mine = evaluate7Cards([...p.hole, ...board]).score;
        let best = 0;
        let ties = 0;
        for (let o = 0; o < opponents; o++) {
            const s = evaluate7Cards([d[k++], d[k++], ...board]).score;
            if (s > best) { best = s; ties = 0; }
            if (s === best) ties++;
        }
        if (mine > best) score += 1;
        else if (mine === best) score += 1 / (ties + 1);
    }
    return score / iterations;
}

function botDecide(table, rng = Math.random) {
    const legal = legalActions(table);
    const p = legal.player;
    const equity = estimateEquity(table, p, 250, rng);
    const potOdds = legal.toCall / (pot(table) + legal.toCall || 1);
    const bluff = rng() < 0.07;

    if (legal.canRaise && (equity > 0.62 || (bluff && legal.canCheck))) return 'raise';
    if (legal.canCheck) return 'check';
    if (equity >= potOdds * 1.1 || equity > 0.45) return 'call';
    return 'fold';
}

/** Cho các máy tự đánh cho tới khi tới lượt người hoặc hết ván. */
function runBots(table, rng = Math.random) {
    let guard = 0;
    while (STAGES.includes(table.stage) && table.players[table.toAct]?.isBot && guard++ < 200) {
        const bot = table.players[table.toAct];
        act(table, bot.id, botDecide(table, rng));
    }
}

module.exports = {
    STAGES,
    STAGE_NAMES,
    MAX_SEATS,
    createTable,
    addPlayer,
    removePlayer,
    startHand,
    legalActions,
    act,
    runBots,
    computePayouts,
    pot,
    raiseSize,
};
