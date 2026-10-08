require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  buildGameStartingSoonEmbed,
  sendDirectMessage,
} = require('../src/services/notificationService');

const TEST_USER_ID = process.argv[2] || '1499809147577958483';

(async () => {
  console.log(`🧪 [TEST 3] Bắt đầu test gửi thông báo NHẮC VÀO GAME (30P TRƯỚC GIỜ ĐẤU) tới user: ${TEST_USER_ID}...`);

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

  const embed = buildGameStartingSoonEmbed({
    event,
    minutesLeft: 30,
  });

  console.log('📤 Đang gửi DM...');
  const result = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed] });

  if (result.success) {
    console.log(`✅ [TEST 3 THÀNH CÔNG] Đã gửi thông báo nhắc vào game 30p tới ${TEST_USER_ID}`);
  } else {
    console.error(`❌ [TEST 3 THẤT BẠI] Lỗi: ${result.reason}`);
  }

  process.exit(0);
})();
