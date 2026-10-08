// 1. Nạp dotenv LÊN ĐẦU FILE
require('dotenv').config();

const client = require('./src/core/client');
const { connectDB } = require('./src/core/database');
const { startServer } = require('./src/core/server');
const { loadFeatures, registerCoreEvents } = require('./src/core/loader');
const { startEventScheduler } = require('./src/services/eventScheduler');
const { startLineupWatcher } = require('./src/services/lineupWatcher');

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

  // Khởi động web server API nội bộ
  startServer(client);

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

  // Khởi động bộ lập lịch gửi thông báo sự kiện (Scheduler)
  startEventScheduler(client);

  // Khởi động bộ theo dõi lưu đội hình (Watcher qua MongoDB)
  startLineupWatcher(client);
})();