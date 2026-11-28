const mongoose = require('mongoose');

/**
 * Trạng thái chung của bot (một dòng cho mỗi khoá `_id`), vd. lần cuối phát quà đền bù khi bot khởi động lại.
 */
const BotStateSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    lastRestartGiftAt: { type: Date, default: null },
    restartGiftCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('BotState', BotStateSchema);
