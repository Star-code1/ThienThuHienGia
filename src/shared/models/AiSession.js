const mongoose = require('mongoose');

/**
 * Phiên trò chuyện với AI (Hiền giả / Tiểu Hàn) của 1 người trong 1 kênh.
 * Tự xóa sau SESSION_TTL_SECONDS không hoạt động.
 */
const SESSION_TTL_SECONDS = 2 * 60 * 60;

const AiSessionSchema = new mongoose.Schema({
    guildId: { type: String, default: 'dm' },
    channelId: { type: String, required: true },
    userId: { type: String, required: true },
    bot: { type: String, required: true, enum: ['hiengia', 'tieuhan'] },
    messages: [{
        _id: false,
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, required: true },
    }],
    turns: { type: Number, default: 0 },
    // ID các tin nhắn trả lời của bot trong phiên — reply vào tin nào thì nối tiếp phiên đó
    messageIds: { type: [String], index: true },
    lastActiveAt: { type: Date, default: Date.now, expires: SESSION_TTL_SECONDS },
});

AiSessionSchema.index({ guildId: 1, channelId: 1, userId: 1, bot: 1 }, { unique: true });

module.exports = mongoose.model('AiSession', AiSessionSchema);
module.exports.SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
