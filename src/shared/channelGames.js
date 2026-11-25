/**
 * Sổ đăng ký game chữ theo kênh: mỗi kênh chỉ chạy MỘT game nhận tin nhắn thường
 * (Nối Từ hoặc Vua Tiếng Việt) để hai game không "ăn" tin nhắn của nhau.
 */
const owners = new Map(); // channelId -> 'noitu' | 'vuatiengviet'

/** Đăng ký kênh. Trả về tên game đang chiếm kênh (khác `type`) hoặc null nếu thành công. */
function claimChannel(channelId, type) {
    const current = owners.get(channelId);
    if (current && current !== type) return current;
    owners.set(channelId, type);
    return null;
}

function releaseChannel(channelId, type) {
    if (owners.get(channelId) === type) owners.delete(channelId);
}

const GAME_LABELS = { noitu: 'Nối Từ', vuatiengviet: 'Vua Tiếng Việt' };
const gameLabel = (type) => GAME_LABELS[type] || type;

module.exports = { claimChannel, releaseChannel, gameLabel };
