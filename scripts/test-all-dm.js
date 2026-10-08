require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  buildUnvotedReminderEmbed,
  buildLineupAssignmentEmbed,
  buildGameStartingSoonEmbed,
  buildTentativeConfirmEmbed,
  sendDirectMessage,
} = require('../src/services/notificationService');

const TEST_USER_ID = process.argv[2] || '1499809147577958483';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log(`\n🧪 ========================================================`);
  console.log(`   TEST TOÀN BỘ 4 MẪU THÔNG BÁO DM DISCORD`);
  console.log(`   Người nhận: User ID ${TEST_USER_ID}`);
  console.log(`   Kênh sự kiện: ${NOTIFICATION_CONFIG.TARGET_CHANNEL_ID}`);
  console.log(`   Role mục tiêu: ${NOTIFICATION_CONFIG.TARGET_ROLE_ID}`);
  console.log(`========================================================\n`);

  console.log('⏳ 1. Đang kết nối MongoDB...');
  try {
    await connectDB();
    console.log('✅ 1. Kết nối MongoDB thành công.');
  } catch (e) {
    console.warn('⚠️ MongoDB kết nối chậm hoặc lỗi:', e.message);
  }

  console.log('⏳ 2. Đang đăng nhập Discord Client...');
  await client.login(process.env.DISCORD_TOKEN);
  console.log(`✅ 2. Đã đăng nhập Discord bot: ${client.user.tag}`);

  let event = null;
  try {
    event = await Event.findOne({
      channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID,
    }).sort({ createdAt: -1 });
  } catch (err) {
    console.warn('⚠️ Lỗi truy vấn event DB:', err.message);
  }

  if (!event) {
    console.log('ℹ️ Sử dụng dữ liệu mẫu cho sự kiện test.');
    event = {
      title: 'ĐIỂM DANH BANG CHIẾN MẪU',
      date: new Date(),
      time: '20:00',
    };
  }

  // 1. Test nhắc chưa vote
  console.log('\n1️⃣ [Test 1/4] Gửi thông báo NHẮC CHƯA ĐIỂM DANH (48h)...');
  const embed1 = buildUnvotedReminderEmbed({ event, milestoneHours: 48 });
  const res1 = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed1] });
  console.log(res1.success ? '  ✅ Thành công!' : `  ❌ Lỗi: ${res1.reason}`);
  await sleep(1000);

  // 2. Test thông báo đội hình & skill
  console.log('\n2️⃣ [Test 2/4] Gửi thông báo PHÂN CÔNG ĐỘI HÌNH & KỸ NĂNG...');
  const embed2 = buildLineupAssignmentEmbed({
    event,
    divisionName: 'Đoàn 1 - Tiên Phong Phá Trụ',
    teamName: 'Team 1 - Đánh Cánh Trái',
    slotIndex: 0,
    roleName: 'Đánh trụ ở Cánh 🏰',
    note: 'Cắn buff công thủ, giữ cự ly với Tố Vấn để nhận hồi máu',
    skills: [
      { id: 's1', name: 'Kim Cương Bất Hoại (Tuyệt Kỹ)' },
      { id: 's2', name: 'Cấm Trị Liệu AoE' },
    ],
  });
  const res2 = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed2] });
  console.log(res2.success ? '  ✅ Thành công!' : `  ❌ Lỗi: ${res2.reason}`);
  await sleep(1000);

  // 3. Test nhắc vào game trước 30p
  console.log('\n3️⃣ [Test 3/4] Gửi thông báo NHẮC VÀO GAME (30 PHÚT)...');
  const embed3 = buildGameStartingSoonEmbed({ event, minutesLeft: 30 });
  const res3 = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed3] });
  console.log(res3.success ? '  ✅ Thành công!' : `  ❌ Lỗi: ${res3.reason}`);
  await sleep(1000);

  // 4. Test nhắc chốt vote 24h
  console.log('\n4️⃣ [Test 4/4] Gửi thông báo NHẮC CHỐT PHIẾU VOTE "CHƯA CHẮC CHẮN" (24H)...');
  const embed4 = buildTentativeConfirmEmbed({ event, hoursLeft: 24 });
  const res4 = await sendDirectMessage(client, TEST_USER_ID, { embeds: [embed4] });
  console.log(res4.success ? '  ✅ Thành công!' : `  ❌ Lỗi: ${res4.reason}`);

  console.log(`\n🏁 ========================================================`);
  console.log(`   ĐÃ HOÀN TẤT CHẠY TEST TẤT CẢ LỜI NHẮC!`);
  console.log(`========================================================\n`);

  process.exit(0);
})();
