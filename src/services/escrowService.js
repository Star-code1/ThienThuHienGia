/**
 * Sổ cái tiền đang bị giữ ở bàn chơi + khôi phục khi bot sập.
 *
 * - Game gọi `hold` khi giữ tiền, `release` khi đã trả/thanh toán xong (mọi lỗi DB chỉ ghi log, không chặn game).
 * - Tiến trình đang sống định kỳ "đập tim" (heartbeat) các dòng của mình.
 * - Dòng nào không còn tim đập quá STALE_MS ⇒ tiến trình giữ nó đã sập ⇒ hoàn tiền + đền bù COMPENSATION
 *   và báo cho người chơi (tin nhắn riêng, không được thì báo ở kênh cũ).
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

async function safe(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.error(`❌ [Escrow] ${label}:`, err.message);
        return null;
    }
}

/** Ghi nhận giữ thêm `amount` Linh Thạch của userId tại bàn refId (cộng dồn). */
const hold = (userId, game, refId, amount, channelId = null) => safe('hold', () =>
    GameEscrow.updateOne(
        { userId, game, refId },
        { $inc: { amount }, $set: { channelId, instanceId: INSTANCE_ID, heartbeatAt: new Date() } },
        { upsert: true }
    ));

/** Đặt số tiền đang giữ (vd: chip Poker sau mỗi ván). */
const setAmount = (userId, game, refId, amount) => safe('setAmount', () =>
    GameEscrow.updateOne({ userId, game, refId }, { $set: { amount, heartbeatAt: new Date() } }));

/** Đã trả/thanh toán xong → xoá khỏi sổ. */
const release = (userId, game, refId) => safe('release', () =>
    GameEscrow.deleteOne({ userId, game, refId }));

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

/**
 * Hoàn tiền + đền bù cho các dòng bị bỏ rơi. Mỗi người chỉ nhận MỘT khoản đền bù mỗi lần khôi phục.
 * @returns {Promise<number>} số người được khôi phục
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
        // "Giành" từng dòng bằng cách xoá nguyên tử: nhiều tiến trình cùng quét cũng không trả hai lần
        const claimed = [];
        for (const doc of docs) {
            const got = await safe('claim', () => GameEscrow.findOneAndDelete({ _id: doc._id, heartbeatAt: { $lt: cutoff } }));
            if (got) claimed.push(got);
        }
        if (!claimed.length) continue;

        const refunded = claimed.reduce((s, d) => s + Math.max(0, d.amount || 0), 0);
        const credited = await safe('credit', () => UserProfile.incLinhThachById(userId, refunded + COMPENSATION));
        if (!credited) {
            // Không cộng được (lỗi DB / chưa có hồ sơ) → trả dòng về sổ để lần quét sau thử lại
            for (const d of claimed) {
                await safe('restore', () => GameEscrow.updateOne(
                    { userId: d.userId, game: d.game, refId: d.refId },
                    { $set: { amount: d.amount, channelId: d.channelId, instanceId: d.instanceId, heartbeatAt: d.heartbeatAt } },
                    { upsert: true }
                ));
            }
            continue;
        }

        recovered++;
        const lines = claimed.map((d) => `${GAME_LABELS[d.game] || d.game}: ${fmt(d.amount)} 💎`);
        console.log(`🩹 [Escrow] Khôi phục ${userId}: hoàn ${refunded} + đền bù ${COMPENSATION}`);
        await notify(client, userId, claimed.find((d) => d.channelId)?.channelId, buildNotice(lines, refunded));
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
    hold, setAmount, release, heartbeat, recoverStale, startEscrowService,
};
