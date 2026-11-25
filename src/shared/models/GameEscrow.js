const mongoose = require('mongoose');

/**
 * Sổ tiền đang bị GIỮ ở các bàn chơi (Xì Dách, Poker, Bầu Cua).
 * Mỗi dòng = số Linh Thạch của một người đang nằm trong một bàn/sòng. Bàn kết thúc bình thường
 * hoặc bot tắt êm thì dòng bị xoá; nếu bot SẬP thì dòng còn lại và được hoàn + đền bù khi bot sống lại.
 */
const GameEscrowSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    game: { type: String, required: true },          // 'xidach' | 'poker' | 'baucua'
    refId: { type: String, required: true },         // id bàn / sòng
    amount: { type: Number, required: true, default: 0 },
    channelId: { type: String, default: null },      // kênh để báo tin nếu không nhắn riêng được
    instanceId: { type: String, required: true },    // tiến trình bot đang giữ dòng này
    heartbeatAt: { type: Date, required: true, default: Date.now, index: true },
}, { timestamps: true });

GameEscrowSchema.index({ userId: 1, game: 1, refId: 1 }, { unique: true });

module.exports = mongoose.model('GameEscrow', GameEscrowSchema);
