require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  buildUnvotedReminderEmbed,
  sendDirectMessage,
} = require('../src/services/notificationService');

const TEST_USER_ID = process.argv[2] || '1499809147577958483';

(async () => {
  console.log(`🧪 [TEST 1] Bắt đầu test gửi thông báo CHƯA ĐIỂM DANH tới user: ${TEST_USER_ID}...`);

  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);

  let event = await Event.findOne({
    channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID,
  }).sort({ createdAt: -1 });

  if (!event) {
    console.log('ℹ️ Không tìm thấy event trong DB kênh 1515709357856264212, sử dụng dữ liệu mẫu.');
    event = {
      title: 'ĐIỂM DANH BANG CHIẾN TỐI NAY',
      date: new Date(),
      time: '20:00',
      messageId: 'mock_message_id',
    };
  }

  const embed = buildUnvotedReminderEmbed({
    event,
    milestoneHours: 48,
  });

  console.log('📤 Đang gửi DM...');
  const result = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed] });

  if (result.success) {
    console.log(`✅ [TEST 1 THÀNH CÔNG] Đã gửi thông báo nhắc chưa điểm danh tới ${TEST_USER_ID}`);
  } else {
    console.error(`❌ [TEST 1 THẤT BẠI] Lỗi: ${result.reason}`);
  }

  process.exit(0);
})();
