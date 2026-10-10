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

  const mockTeammates = [
    { slotIndex: 0, userId: TEST_USER_ID, displayName: 'Chỉ Huy Trưởng', className: 'Thiết Y', roleName: 'Leader', note: 'Ưu tiên cắn buff thủ' },
    { slotIndex: 1, userId: '1438967271149146302', displayName: 'Phó Tướng A', className: 'Long Ngâm', roleName: 'DPS', note: '' },
    { slotIndex: 2, userId: null, displayName: 'Thần Y B', className: 'Tố Vấn', roleName: 'Heal', note: 'Theo sát tank' },
    { slotIndex: 3, userId: null, displayName: '', className: '', roleName: '', note: '' },
    { slotIndex: 4, userId: null, displayName: '', className: '', roleName: '', note: '' },
    { slotIndex: 5, userId: null, displayName: '', className: '', roleName: '', note: '' },
  ];

  const embed = buildLineupAssignmentEmbed({
    event,
    divisionName: 'Đoàn 1 - Tiên Phong Phá Trụ',
    divisionNote: 'Tập trung phá trụ cánh trái trước 20h15',
    teamName: 'Team 1 - Đánh Trụ Cánh Trái',
    teamNote: 'Bọc lót cho Healer, cấm giao tranh lẻ',
    slotIndex: 0,
    roleName: 'Đánh trụ ở Cánh 🏰',
    note: 'Ưu tiên cắn buff thủ và gom địch cho DPS xả skill',
    skills: mockSkills,
    teammates: mockTeammates,
    currentUserId: TEST_USER_ID,
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
