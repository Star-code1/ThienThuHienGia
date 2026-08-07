const { Events } = require('discord.js');
const { processIncomingMessage } = require('../services/memoryService');

module.exports = {
    name: Events.MessageCreate,
    once: false,
    async execute(message) {
        if (!message || message.author.bot) return;

        // 1. Lưu message vào MongoDB & Xử lý Rule Engine / Embedding / Summary Queue
        try {
            await processIncomingMessage(message);
        } catch (err) {
            console.error('❌ Lỗi processIncomingMessage:', err.message);
        }
    }
};
