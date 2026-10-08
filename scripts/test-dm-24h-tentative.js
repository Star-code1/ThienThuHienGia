require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  buildTentativeConfirmEmbed,
  sendDirectMessage,
} = require('../src/services/notificationService');

const TEST_USER_ID = process.argv[2] || '1499809147577958483';

(async () => {
  console.log(`🧪 [TEST 4] Bắt đầu test gửi thông báo NHẮC CHỐT VOTE CHƯA CHẮC CHẮN (24H TRƯỚC GIỜ ĐẤU) tới user: ${TEST_USER_ID}...`);

  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);

  let event = await Event.findOne({
    channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID,
  }).sort({ createdAt: -1 });

  if (!event) {
    event = {
      title: 'BANG CHIẾN THIÊN THU MÔN',
      date: new Date(),
      time: '20:00',
    };
  }

  const embed = buildTentativeConfirmEmbed({
    event,
    hoursLeft: 24,
  });

  console.log('📤 Đang gửi DM...');
  const result = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed] });

  if (result.success) {
    console.log(`✅ [TEST 4 THÀNH CÔNG] Đã gửi thông báo nhắc chốt vote 24h tới ${TEST_USER_ID}`);
  } else {
    console.error(`❌ [TEST 4 THẤT BẠI] Lỗi: ${result.reason}`);
  }

  process.exit(0);
})();
