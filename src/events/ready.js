const { Events } = require('discord.js');
const { pruneOldVectors } = require('../services/qdrantService');

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`🤖 Bot đã online: ${client.user.tag}`);

    // Dọn vector Qdrant cũ hơn 60 ngày (khớp TTL tin nhắn MongoDB), chạy ngay rồi mỗi 24h
    const prune = () => pruneOldVectors().catch(err => console.warn('⚠️ Lỗi dọn vector cũ:', err.message));
    prune();
    setInterval(prune, PRUNE_INTERVAL_MS).unref();
  },
};
