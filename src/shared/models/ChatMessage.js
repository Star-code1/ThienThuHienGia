const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    messageId: { type: String, required: true, unique: true, index: true },
    authorId: { type: String, required: true },
    username: { type: String, required: true },
    content: { type: String, required: true },
    replyTo: { type: String, default: null },
    attachments: { type: Array, default: [] },
    mentions: { type: Array, default: [] },
    embedding: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema);
