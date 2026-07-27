// 1. Nạp dotenv LÊN ĐẦU FILE
require('dotenv').config();

const client = require('./src/core/client');
const { connectDB } = require('./src/core/database');
const { startServer } = require('./src/core/server');
const { loadFeatures, registerCoreEvents } = require('./src/core/loader');

// ── Global Error Handlers ─────────────────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('========== UNHANDLED REJECTION ==========\nReason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('========== UNCAUGHT EXCEPTION ==========\n', err);
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(async () => {
  // Kết nối MongoDB
  await connectDB();

  // Khởi động web server (keep-alive)
  startServer();

  // Load tất cả features (commands, interactions, events)
  console.log('\n📦 Loading features...');
  loadFeatures(client);

  // Đăng ký core events (ready, interactionCreate)
  console.log('\n🔗 Registering core events...');
  registerCoreEvents(client);

  // Login Discord
  console.log('\n🔐 Logging in...');
  await client.login(process.env.DISCORD_TOKEN);
  console.log('✅ Discord login thành công.');
})();