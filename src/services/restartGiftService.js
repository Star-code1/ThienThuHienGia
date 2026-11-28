/**
 * Quà đền bù khi bot khởi động lại: mỗi lần bot online trở lại sau khi ngưng hoạt động,
 * MỌI người chơi đã có hồ sơ được cộng RESTART_GIFT Linh Thạch.
 *
 * - "Giành" lượt phát bằng một thao tác nguyên tử trên BotState → nhiều tiến trình cùng khởi động
 *   (lúc deploy) cũng chỉ phát MỘT lần.
 * - Giữa hai lần phát tối thiểu COOLDOWN_MS, tránh bot sập-khởi động liên tục làm lạm phát Linh Thạch.
 * - Báo tin ở kênh DEFAULT_CHANNEL_ID (hoặc RESTART_GIFT_CHANNEL_ID nếu có cấu hình).
 */
const BotState = require('../shared/models/BotState');
const UserProfile = require('../shared/models/UserProfile');

const RESTART_GIFT = 10_000;
const COOLDOWN_MS = Number(process.env.RESTART_GIFT_COOLDOWN_MS) || 30 * 60_000;
const STATE_ID = 'restart-gift';
// Kênh thông báo quà đền bù (đổi được qua RESTART_GIFT_CHANNEL_ID)
const DEFAULT_CHANNEL_ID = '1534508222407245965';

const fmt = (n) => Number(n).toLocaleString('vi-VN');

const buildNotice = (count) =>
    `🎁 **QUÀ ĐỀN BÙ** — Thiên Thư Hiền Giả đã trở lại sau thời gian ngưng hoạt động!\n` +
    `Để tạ lỗi, toàn bộ **${fmt(count)}** đạo hữu đã được cộng **+${fmt(RESTART_GIFT)}** 💎 Linh Thạch. Chúc chư vị chơi vui! 🙏`;

/**
 * Phát quà nếu chưa phát trong COOLDOWN_MS gần nhất.
 * @returns {Promise<{ given: boolean, count?: number }>}
 */
async function grantRestartGift(client, { now = Date.now() } = {}) {
    const cutoff = new Date(now - COOLDOWN_MS);
    let claimed;
    try {
        claimed = await BotState.findOneAndUpdate(
            { _id: STATE_ID, $or: [{ lastRestartGiftAt: null }, { lastRestartGiftAt: { $lt: cutoff } }] },
            { $set: { lastRestartGiftAt: new Date(now) }, $inc: { restartGiftCount: 1 } },
            { upsert: true, new: true }
        );
    } catch (err) {
        // Dòng đã có và vừa phát gần đây → upsert đụng khoá trùng _id: coi như không giành được
        if (err?.code === 11000) return { given: false };
        console.error('❌ [RestartGift] claim:', err.message);
        return { given: false };
    }
    if (!claimed) return { given: false };

    let count;
    try {
        const res = await UserProfile.updateMany({}, { $inc: { linhThach: RESTART_GIFT } });
        count = res?.modifiedCount ?? 0;
    } catch (err) {
        console.error('❌ [RestartGift] cộng Linh Thạch:', err.message);
        // Chưa phát được → trả lại lượt để lần khởi động sau thử lại
        await BotState.updateOne({ _id: STATE_ID }, { $set: { lastRestartGiftAt: null }, $inc: { restartGiftCount: -1 } }).catch(() => {});
        return { given: false };
    }

    console.log(`🎁 [RestartGift] Đã cộng ${RESTART_GIFT} Linh Thạch cho ${count} người chơi.`);
    const channelId = process.env.RESTART_GIFT_CHANNEL_ID || DEFAULT_CHANNEL_ID;
    if (client && channelId && count > 0) {
        try {
            const channel = await client.channels.fetch(channelId);
            await channel.send({ content: buildNotice(count), allowedMentions: { parse: [] } });
        } catch (err) {
            console.warn('⚠️ [RestartGift] Không gửi được thông báo:', err.message);
        }
    }
    return { given: true, count };
}

module.exports = { RESTART_GIFT, COOLDOWN_MS, grantRestartGift, buildNotice };
