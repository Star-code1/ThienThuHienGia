require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  buildLineupAssignmentEmbed,
  sendDirectMessage,
} = require('../src/services/notificationService');

const TEST_USER_ID = process.argv[2] || '1499809147577958483';

(async () => {
  console.log(`🧪 [TEST 2] Bắt đầu test gửi thông báo PHÂN CÔNG ĐỘI HÌNH & SKILL tới user: ${TEST_USER_ID}...`);

  await connectDB();
  await client.login(process.env.DISCORD_TOKEN);

  let event = await Event.findOne({
    channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID,
  }).sort({ createdAt: -1 });

  if (!event) {
    event = {
      title: 'ĐỘI HÌNH BANG CHIẾN LIÊN SERVER',
      date: new Date(),
      time: '20:30',
    };
  }

  const mockSkills = [
    { id: 'skill_1', name: 'Kim Cương Bất Hoại (Tuyệt Kỹ)' },
    { id: 'skill_2', name: 'Sư Tử Hống (Khống Chế)' },
    { id: 'skill_3', name: 'Cấm Trị Liệu AoE' },
  ];

  const embed = buildLineupAssignmentEmbed({
    event,
    divisionName: 'Đoàn 1 - Tiên Phong Phá Trụ',
    teamName: 'Team 1 - Đánh Trụ Cánh Trái',
    slotIndex: 0,
    roleName: 'Đánh trụ ở Cánh 🏰',
    note: 'Ưu tiên cắn buff thủ và gom địch cho DPS xả skill',
    skills: mockSkills,
  });

  console.log('📤 Đang gửi DM...');
  const result = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed] });

  if (result.success) {
    console.log(`✅ [TEST 2 THÀNH CÔNG] Đã gửi thông báo phân công đội hình & skill tới ${TEST_USER_ID}`);
  } else {
    console.error(`❌ [TEST 2 THẤT BẠI] Lỗi: ${result.reason}`);
  }

  process.exit(0);
})();
