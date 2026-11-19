/**
 * Gửi thử các tin nhắn DM thông báo tới tài khoản test (mặc định: taobao_123456).
 *
 *   pnpm run test:dm [loại] [người nhận]
 *
 * loại: all (mặc định) | unvoted | lineup | lineup-update | unassigned | 30m | tentative
 * người nhận: username, tên hiển thị hoặc User ID (mặc định taobao_123456 / env TEST_DM_TARGET)
 */
require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const Event = require('../src/features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  buildUnvotedReminderEmbed,
  buildLineupAssignmentEmbed,
  buildUnassignedNoticeEmbed,
  buildGameStartingSoonEmbed,
  buildTentativeConfirmEmbed,
  sendDirectMessage,
} = require('../src/services/notificationService');
const { buildVoiceButtonsRow } = require('../src/shared/voiceChannels');
const { DEFAULT_TEST_TARGET, loginAndWait, resolveTargetUserId } = require('./lib/testTarget');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dữ liệu đội hình mẫu, đặt người test vào vị trí số 2 */
function sampleLineup(userId, isUpdate) {
  return {
    divisionName: isUpdate ? 'Đoàn 2 - Bọc Hậu Cánh Phải' : 'Đoàn 1 - Tiên Phong',
    divisionNote: isUpdate ? 'Chặn đường lui của địch' : 'Tiến công trực diện',
    teamName: isUpdate ? 'Team 3 - Sát Thủ Cánh' : 'Team 1 - Phá Cổng',
    teamNote: isUpdate ? 'Ưu tiên bắt Healer địch' : 'Dồn dame cổng chính',
    slotIndex: 1,
    roleName: isUpdate ? 'Sát Thủ' : 'Main Tank',
    note: isUpdate ? 'Bắt Healer ngay khi giao tranh' : 'Cắn buff thủ, giữ cự ly với Tố Vấn',
    skills: isUpdate
      ? [{ name: 'Ảo Ảnh Kiếm' }, { name: 'Tuyệt Kỹ Cắt Họng' }]
      : [{ name: 'Kim Cương Bất Hoại' }, { name: 'Cấm Trị Liệu AoE' }],
    teammates: [
      { slotIndex: 0, displayName: 'Chỉ Huy Trưởng', className: 'Thiết Y', roleName: 'Leader', note: 'Nghe lệnh trên voice' },
      { slotIndex: 1, userId, className: isUpdate ? 'Toái Mộng' : 'Thiết Y', roleName: isUpdate ? 'Sát Thủ' : 'Main Tank' },
      { slotIndex: 2, displayName: 'Tố Vấn Hồi Máu', className: 'Tố Vấn', roleName: 'Healer' },
      { slotIndex: 3 },
    ],
    currentUserId: userId,
    isUpdate,
  };
}

/** Payload giống hệt bot gửi thật trong notificationService */
const MESSAGES = {
  unvoted: {
    label: 'Nhắc chưa điểm danh (mốc 48h)',
    payload: ({ event }) => ({ embeds: [buildUnvotedReminderEmbed({ event, milestoneHours: 48 })] }),
  },
  lineup: {
    label: 'Phân công đội hình (gửi lần đầu)',
    payload: ({ event, userId }) => ({ embeds: [buildLineupAssignmentEmbed({ event, ...sampleLineup(userId, false) })] }),
  },
  'lineup-update': {
    label: 'Đội hình có cập nhật',
    payload: ({ event, userId }) => ({
      content: '🔔 **Vị trí của bạn có sự cập nhật**',
      embeds: [buildLineupAssignmentEmbed({ event, ...sampleLineup(userId, true) })],
    }),
  },
  unassigned: {
    label: 'Bị rút khỏi đội hình (về dự bị)',
    payload: ({ event }) => ({
      content: '🔔 **Vị trí của bạn có sự cập nhật**',
      embeds: [buildUnassignedNoticeEmbed({ event })],
    }),
  },
  '30m': {
    label: 'Nhắc vào trận trước 30 phút (kèm nút voice)',
    payload: ({ event }) => ({
      embeds: [buildGameStartingSoonEmbed({ event, minutesLeft: 30 })],
      components: [buildVoiceButtonsRow()],
    }),
  },
  tentative: {
    label: 'Nhắc chốt phiếu "Chưa chắc chắn" (24h)',
    payload: ({ event }) => ({ embeds: [buildTentativeConfirmEmbed({ event, hoursLeft: 24 })] }),
  },
};

async function loadEvent() {
  try {
    const event = await Event.findOne({ channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID }).sort({ createdAt: -1 }).lean();
    if (event) return event;
  } catch (err) {
    console.warn('⚠️ Không đọc được sự kiện từ DB:', err.message);
  }
  console.log('ℹ️ Dùng sự kiện mẫu.');
  return { title: 'BANG CHIẾN THIÊN THƯ MÔN', date: new Date(), time: '20:00' };
}

(async () => {
  const type = (process.argv[2] || 'all').toLowerCase();
  const target = process.argv[3] || DEFAULT_TEST_TARGET;
  const types = type === 'all' ? Object.keys(MESSAGES) : [type];

  if (types.some((t) => !MESSAGES[t])) {
    console.error(`❌ Loại không hợp lệ: "${type}". Chọn: all, ${Object.keys(MESSAGES).join(', ')}`);
    process.exit(1);
  }

  let exitCode = 0;
  try {
    await connectDB().catch((e) => console.warn('⚠️ MongoDB lỗi, vẫn tiếp tục:', e.message));
    await loginAndWait(client);
    console.log(`✅ Bot: ${client.user.tag}`);

    const userId = await resolveTargetUserId(client, target);
    console.log(`🎯 Người nhận: ${target} (${userId})\n`);

    const event = await loadEvent();
    let ok = 0;
    for (const [i, t] of types.entries()) {
      const { label, payload } = MESSAGES[t];
      const res = await sendDirectMessage(client, userId, payload({ event, userId }));
      console.log(`${res.success ? '✅' : '❌'} [${i + 1}/${types.length}] ${t} — ${label}${res.success ? '' : ` → ${res.reason}`}`);
      if (res.success) ok++;
      if (i < types.length - 1) await sleep(1000);
    }

    console.log(`\n🏁 Đã gửi ${ok}/${types.length} tin.`);
    if (ok < types.length) exitCode = 1;
  } catch (err) {
    console.error('❌', err.message);
    exitCode = 1;
  }
  await client.destroy();
  process.exit(exitCode);
})();
