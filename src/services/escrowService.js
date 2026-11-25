/**
 * Sổ cái tiền đang bị giữ ở bàn chơi (Xì Dách, Poker, Bầu Cua) + khôi phục khi bot sập.
 *
 * NGUYÊN TẮC "GHI TRƯỚC, TIÊU SAU" (write-ahead): mọi lần giữ/trả tiền đều
 *   1) ghi ý định vào sổ (`pending`),
 *   2) đổi số dư người chơi, kèm dấu vết `tx` ngay trong hồ sơ người chơi (cùng một thao tác nguyên tử),
 *   3) xác nhận vào sổ.
 * Bot sập ở bất kỳ bước nào cũng suy ra được tiền đã đổi chưa (nhìn dấu vết `tx`), nên người chơi
 * không bao giờ mất tiền và cũng không bao giờ được trả hai lần.
 *
 * Tiến trình đang sống "đập tim" (heartbeat) các dòng của mình; dòng mất tim > STALE_MS = bot đã sập ⇒
 * hoàn tiền + đền bù COMPENSATION và báo cho người chơi.
 */
const crypto = require('node:crypto');
const GameEscrow = require('../shared/models/GameEscrow');
const UserProfile = require('../shared/models/UserProfile');

const COMPENSATION = 10_000;
const HEARTBEAT_MS = 60_000;
const SWEEP_MS = 60_000;
const STALE_MS = 150_000;
const INSTANCE_ID = crypto.randomUUID();

const GAME_LABELS = { xidach: '🃏 Xì Dách', poker: '♠️ Poker', baucua: '🎲 Bầu Cua' };
const fmt = (n) => Number(n).toLocaleString('vi-VN');
const newTx = (kind, game, refId) => `${kind}:${game}:${refId}:${crypto.randomUUID().slice(0, 8)}`;

async function safe(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.error(`❌ [Escrow] ${label}:`, err.message);
        return null;
    }
}

const key = (userId, game, refId) => ({ userId, game, refId });

/**
 * GIỮ tiền: trừ `amount` Linh Thạch của người chơi và ghi vào sổ.
 * @returns {Promise<boolean>} true nếu giữ được; false nếu không đủ tiền (không đổi gì).
 * Lỗi DB thì ném ra (lúc đó tiền chưa bị trừ hoặc sẽ được khôi phục từ sổ).
 */
async function charge(userId, game, refId, amount, channelId = null) {
    const tx = newTx('in', game, refId);
    // 1) ghi ý định TRƯỚC
    await GameEscrow.updateOne(
        key(userId, game, refId),
        { $push: { pending: { txId: tx, amount } }, $set: { channelId, instanceId: INSTANCE_ID, heartbeatAt: new Date() } },
        { upsert: true }
    );
    // 2) trừ tiền, đánh dấu tx cùng lúc
    let taken;
    try {
        taken = await UserProfile.incLinhThachById(userId, -amount, { requireFunds: true, tx });
    } catch (err) {
        throw err; // không rõ đã trừ chưa → để dòng pending lại, khôi phục sẽ tự xét theo dấu vết tx
    }
    if (!taken) {
        await safe('unstage', async () => {
            await GameEscrow.updateOne(key(userId, game, refId), { $pull: { pending: { txId: tx } } });
            await GameEscrow.deleteOne({ ...key(userId, game, refId), amount: 0, pending: [] });
        });
        return false;
    }
    // 3) xác nhận
    await safe('confirm', () => GameEscrow.updateOne(
        key(userId, game, refId),
        { $inc: { amount }, $pull: { pending: { txId: tx } } }
    ));
    return true;
}

/**
 * TRẢ tiền về người chơi: cộng `credit` (kèm `inc` thống kê) và giảm sổ đi `discharge`.
 * `closes: true` → xoá hẳn dòng sổ (người này đã xong ở bàn này).
 * Ném lỗi nếu DB hỏng — dòng sổ vẫn còn để khôi phục sau.
 */
async function payout(userId, game, refId, { credit, discharge = credit, inc = {}, closes = false }) {
    const tx = newTx('out', game, refId);
    const exists = await GameEscrow.find(key(userId, game, refId)).lean();
    if (exists.length) {
        await GameEscrow.updateOne(key(userId, game, refId), { $push: { pending: { txId: tx, amount: -discharge } } });
    }
    const result = await UserProfile.incLinhThachById(userId, credit, { inc, tx });
    if (exists.length) {
        if (closes) {
            await safe('close', () => GameEscrow.deleteOne(key(userId, game, refId)));
        } else {
            await safe('discharge', () => GameEscrow.updateOne(
                key(userId, game, refId),
                { $inc: { amount: -discharge }, $pull: { pending: { txId: tx } } }
            ));
        }
    }
    return result;
}

/** Đặt số tiền đang giữ (vd: chip Poker sau mỗi ván). */
const setAmount = (userId, game, refId, amount) => safe('setAmount', () =>
    GameEscrow.updateOne(key(userId, game, refId), { $set: { amount, heartbeatAt: new Date() } }));

const heartbeat = () => safe('heartbeat', () =>
    GameEscrow.updateMany({ instanceId: INSTANCE_ID }, { $set: { heartbeatAt: new Date() } }));

function buildNotice(lines, refunded) {
    return (
        `⚠️ **Thiên Thư Hiền Giả** xin lỗi đạo hữu: bot đã gặp sự cố đột ngột trong lúc đạo hữu đang chơi nên ván bài bị huỷ.\n\n` +
        `💰 **Đã hoàn lại:** ${lines.join(' · ')} (tổng **${fmt(refunded)}** 💎)\n` +
        `🎁 **Đền bù sự cố:** **+${fmt(COMPENSATION)}** 💎 Linh Thạch\n\n` +
        `Chúc đạo hữu chơi vui! 🙏`
    );
}

async function notify(client, userId, channelId, text) {
    if (!client) return;
    try {
        const user = await client.users.fetch(userId);
        await user.send(text);
        return;
    } catch (_) { /* DM đóng → thử báo ở kênh */ }
    if (!channelId) return;
    try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ content: `<@${userId}>\n${text}`, allowedMentions: { users: [userId] } });
    } catch (err) {
        console.warn(`⚠️ [Escrow] Không báo được tin cho ${userId}:`, err.message);
    }
}

/** Số tiền thật sự còn nằm trong bàn của một dòng sổ, suy ra từ dấu vết `tx` của người chơi. */
function heldAmount(doc, appliedTx) {
    let total = doc.amount || 0;
    for (const p of doc.pending || []) {
        if (appliedTx.has(p.txId)) total += p.amount; // +: đã trừ chưa xác nhận · −: đã trả chưa ghi giảm
    }
    return Math.max(0, total);
}

/**
 * Hoàn tiền + đền bù cho các dòng bị bỏ rơi. Mỗi người chỉ nhận MỘT khoản đền bù mỗi lần khôi phục,
 * và chỉ khi thật sự có tiền bị kẹt.
 * @returns {Promise<number>} số người được đền bù
 */
async function recoverStale(client, { now = Date.now() } = {}) {
    const cutoff = new Date(now - STALE_MS);
    const stale = await GameEscrow.find({ heartbeatAt: { $lt: cutoff } }).lean();
    if (!stale.length) return 0;

    const byUser = new Map();
    for (const doc of stale) {
        if (!byUser.has(doc.userId)) byUser.set(doc.userId, []);
        byUser.get(doc.userId).push(doc);
    }

    let recovered = 0;
    for (const [userId, docs] of byUser) {
        // "Giành" từng dòng bằng xoá nguyên tử: nhiều tiến trình cùng quét cũng không trả hai lần
        const claimed = [];
        for (const doc of docs) {
            const got = await safe('claim', () => GameEscrow.findOneAndDelete({ _id: doc._id, heartbeatAt: { $lt: cutoff } }));
            if (got) claimed.push(got);
        }
        if (!claimed.length) continue;

        const applied = new Set(await safe('txs', () => UserProfile.getEscrowTxs(userId)) || []);
        const parts = claimed.map((d) => ({ doc: d, held: heldAmount(d, applied) })).filter((x) => x.held > 0);
        if (!parts.length) continue; // không còn tiền kẹt (đã trả xong hoặc chưa kịp trừ) → bỏ dòng, không đền bù

        const refunded = parts.reduce((s, x) => s + x.held, 0);
        const credited = await safe('credit', () => UserProfile.incLinhThachById(userId, refunded + COMPENSATION, { tx: newTx('rec', 'all', userId) }));
        if (!credited) {
            // Không cộng được (lỗi DB / chưa có hồ sơ) → trả dòng về sổ để lần quét sau thử lại
            for (const d of claimed) {
                const { _id, ...rest } = d;
                await safe('restore', () => GameEscrow.updateOne(key(d.userId, d.game, d.refId), { $set: rest }, { upsert: true }));
            }
            continue;
        }

        recovered++;
        const lines = parts.map(({ doc, held }) => `${GAME_LABELS[doc.game] || doc.game}: ${fmt(held)} 💎`);
        console.log(`🩹 [Escrow] Khôi phục ${userId}: hoàn ${refunded} + đền bù ${COMPENSATION}`);
        await notify(client, userId, parts.find((x) => x.doc.channelId)?.doc.channelId, buildNotice(lines, refunded));
    }
    return recovered;
}

/** Bật heartbeat + quét định kỳ. Gọi một lần khi bot ready. */
function startEscrowService(client) {
    const sweep = () => recoverStale(client).catch((err) => console.error('❌ [Escrow] sweep:', err.message));
    sweep();
    setInterval(() => heartbeat(), HEARTBEAT_MS).unref();
    setInterval(sweep, SWEEP_MS).unref();
}

module.exports = {
    COMPENSATION, STALE_MS, INSTANCE_ID,
    charge, payout, setAmount, heartbeat, recoverStale, startEscrowService,
};
