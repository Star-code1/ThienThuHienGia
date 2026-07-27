// Channel IDs cho hệ thống anti-spam
const TRAP_CHANNEL_ID = '1530983844113813545';
const LOG_CHANNEL_ID = '1438974225154183219';

// Thông số anti-spam (chưa dùng, để sẵn cho mở rộng)
const WINDOW = 2500;          // 2.5 giây
const MESSAGE_LIMIT = 3;       // tối thiểu 3 tin
const CHANNEL_LIMIT = 3;       // ở 3 kênh khác nhau

module.exports = { TRAP_CHANNEL_ID, LOG_CHANNEL_ID, WINDOW, MESSAGE_LIMIT, CHANNEL_LIMIT };
