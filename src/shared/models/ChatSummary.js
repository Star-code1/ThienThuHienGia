const mongoose = require('mongoose');

const ChatSummarySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, default: null, index: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    summary: { type: String, required: true },
    messageCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

module.exports = mongoose.model('ChatSummary', ChatSummarySchema);
