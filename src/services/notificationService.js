const { EmbedBuilder } = require('discord.js');
const Attendance = require('../features/attendance/models/Attendance');
const Event = require('../features/attendance/models/Event');

const NOTIFICATION_CONFIG = {
  TARGET_ROLE_ID: '1438967271149146302',
  TARGET_CHANNEL_ID: '1515709357856264212',
  DELAY_BETWEEN_DMS_MS: 150, // Delay tránh chạm rate-limit của Discord
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tính toán thời gian Date đầy đủ từ event.date và event.time
 */
function getEventDateTime(event) {
  if (!event || !event.date) return null;
  const d = new Date(event.date);
  if (isNaN(d.getTime())) return null;

  let hours = 20;
  let minutes = 0;
  if (event.time && typeof event.time === 'string') {
    const cleanTime = event.time.toLowerCase().replace('h', ':');
    const parts = cleanTime.split(':').map((p) => parseInt(p.trim(), 10));
    if (!isNaN(parts[0])) hours = parts[0];
    if (parts.length > 1 && !isNaN(parts[1])) minutes = parts[1];
  }

  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0);
}

/**
 * Gửi tin nhắn riêng (DM) an toàn tới một User ID
 */
async function sendDirectMessage(client, userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    if (!user) {
      console.warn(`[DM Service] Không tìm thấy user: ${userId}`);
      return { success: false, reason: 'User not found' };
    }
    await user.send(payload);
    return { success: true };
  } catch (error) {
    // Error 50007: Cannot send messages to this user (DM disabled / bot blocked)
    console.warn(`[DM Service] Không thể gửi DM tới ${userId}: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * Lấy danh sách Member trong Guild có Role mục tiêu
 */
async function getTargetGuildMembers(client) {
  const members = new Map();
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      const roleMembers = guild.members.cache.filter((m) =>
        m.roles.cache.has(NOTIFICATION_CONFIG.TARGET_ROLE_ID) && !m.user.bot
      );
      roleMembers.forEach((m) => members.set(m.id, m));
    } catch (err) {
      console.error(`[DM Service] Lỗi khi fetch members guild ${guild.id}:`, err.message);
    }
  }
  return members;
}

// ── Embed Builders ─────────────────────────────────────────────────────────────

/**
 * 1. Embed nhắc chưa điểm danh
 */
function buildUnvotedReminderEmbed({ event, milestoneHours }) {
  const dateStr = new Date(event.date).toLocaleDateString('vi-VN');
  return new EmbedBuilder()
    .setColor(0xE67E22)
    .setAuthor({ name: '⚔️ THIÊN THƯ HIỀN GIẢ - NHẮC NHỞ ĐIỂM DANH ⚔️' })
    .setTitle(`📢 ${event.title || 'SỰ KIỆN BANG CHIẾN'}`)
    .setDescription(
      `${DIVIDER}\n` +
      `Chào đạo hữu! Bạn chưa thực hiện điểm danh cho trận Bang Chiến sắp tới.\n\n` +
      `> 🗓️ **Ngày:** \`${dateStr}\`\n` +
      `> 🕗 **Giờ:** \`${event.time}\`\n` +
      `> ⏳ **Thời gian còn lại:** khoảng **${milestoneHours} giờ**\n` +
      `${DIVIDER}\n\n` +
      `👉 **Vui lòng vào kênh** <#${NOTIFICATION_CONFIG.TARGET_CHANNEL_ID}> để vote **Tham gia** hoặc **Báo vắng** giúp Ban Quản Trị kịp thời sắp xếp đội hình!`
    )
    .setFooter({ text: 'Thiên Thư Môn • Hệ thống thông báo tự động' })
    .setTimestamp();
}

/**
 * 2. Embed thông báo xếp đội hình & kỹ năng
 */
function buildLineupAssignmentEmbed({ event, divisionName, teamName, slotIndex, roleName, note, skills = [] }) {
  const dateStr = event ? new Date(event.date).toLocaleDateString('vi-VN') : 'Sắp diễn ra';
  const eventTime = event ? event.time : '20:00';
  const eventTitle = event ? event.title : 'BANG CHIẾN THIÊN THƯ MÔN';

  const skillList = skills.length > 0
    ? skills.map((s) => `• **${s.name || s.id}**`).join('\n')
    : '• *Chưa có kỹ năng chỉ định riêng (sử dụng theo vai trò)*';

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setAuthor({ name: '🛡️ THIÊN THƯ HIỀN GIẢ - PHÂN CÔNG ĐỘI HÌNH 🛡️' })
    .setTitle(`📋 ${eventTitle}`)
    .setDescription(
      `${DIVIDER}\n` +
      `Sơ đồ đội hình Bang Chiến đã được cập nhật. Dưới đây là vị trí và nhiệm vụ của bạn:\n\n` +
      `> 🚩 **Đoàn:** \`${divisionName || 'Đoàn Chưa Đặt Tên'}\`\n` +
      `> ⚔️ **Đội:** \`${teamName || 'Team'}\` (Vị trí: **Số ${slotIndex + 1}**)\n` +
      `> 🗓️ **Thời gian:** \`${eventTime} - ${dateStr}\`\n` +
      `${DIVIDER}`
    )
    .addFields(
      { name: '🔮 Kỹ Năng / Tuyệt Kỹ Yêu Cầu', value: skillList, inline: false },
      { name: '📝 Ghi Chú Riêng', value: note ? `\`${note}\`` : '*Không có ghi chú*', inline: false }
    )
    .setFooter({ text: 'Thiên Thư Môn • Chúc toàn thể anh em bang chiến thắng lợi!' })
    .setTimestamp();

  return embed;
}

/**
 * 3. Embed nhắc vào game trước 30 phút
 */
function buildGameStartingSoonEmbed({ event, minutesLeft = 30 }) {
  const dateStr = new Date(event.date).toLocaleDateString('vi-VN');
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setAuthor({ name: '⏰ THIÊN THƯ HIỀN GIẢ - CHUẨN BỊ VÀO TRẬN ⏰' })
    .setTitle(`🔥 ${event.title || 'BANG CHIẾN SẮP BẮT ĐẦU'}`)
    .setDescription(
      `${DIVIDER}\n` +
      `Chỉ còn **${minutesLeft} phút** nữa là đến giờ diễn ra Bang Chiến!\n\n` +
      `> 🕗 **Giờ bắt đầu:** \`${event.time}\` (Hôm nay \`${dateStr}\`)\n` +
      `> 📍 **Địa điểm Discord:** Kênh Voice Đoàn / Kênh <#${NOTIFICATION_CONFIG.TARGET_CHANNEL_ID}>\n` +
      `${DIVIDER}\n\n` +
      `✅ **Đạo hữu vui lòng:**\n` +
      `1. Mở game, cắn bình buff, kiểm tra trang bị & kỹ năng.\n` +
      `2. Di chuyển vào đúng phòng Voice theo Đoàn đã phân công.\n` +
      `3. Sẵn sàng nghe hiệu lệnh của Chỉ Huy.`
    )
    .setFooter({ text: 'Thiên Thư Môn • Tập trung đúng giờ vì danh dự bang phái!' })
    .setTimestamp();
}

/**
 * 4. Embed nhắc chốt phiếu vote (Chưa chắc chắn -> Chắc chắn) trước 24h
 */
function buildTentativeConfirmEmbed({ event, hoursLeft = 24 }) {
  const dateStr = new Date(event.date).toLocaleDateString('vi-VN');
  return new EmbedBuilder()
    .setColor(0x9B59B6)
    .setAuthor({ name: '⚖️ THIÊN THƯ HIỀN GIẢ - XÁC NHẬN ĐIỂM DANH ⚖️' })
    .setTitle(`⏳ ${event.title || 'XÁC NHẬN THAM GIA BANG CHIẾN'}`)
    .setDescription(
      `${DIVIDER}\n` +
      `Bạn hiện đang để trạng thái **"Chưa chắc chắn"** cho sự kiện Bang Chiến sắp tới.\n\n` +
      `> 🗓️ **Ngày:** \`${dateStr}\` lúc \`${event.time}\`\n` +
      `> ⏳ **Thời gian còn lại:** khoảng **${hoursLeft} giờ**\n` +
      `${DIVIDER}\n\n` +
      `👉 **Vui lòng vào lại kênh** <#${NOTIFICATION_CONFIG.TARGET_CHANNEL_ID}> để **chốt dứt khoát phiếu vote** (Có mặt hoặc Báo vắng) để Ban Quản Trị khóa sơ đồ và chốt danh sách đội hình chính thức!`
    )
    .setFooter({ text: 'Thiên Thư Môn • Hệ thống hỗ trợ quản lý bang chiến' })
    .setTimestamp();
}

// ── Service Execution Handlers ──────────────────────────────────────────────────

/**
 * Yêu cầu 1: Gửi thông báo đến những người CHƯA điểm danh
 */
async function notifyUnvotedMembers(client, event, milestoneHours) {
  if (!event || !event.messageId) return { total: 0, sent: 0, failed: 0 };

  console.log(`[Notification Service] 🚀 Bắt đầu gửi nhắc chưa điểm danh (Mốc ${milestoneHours}h) cho event: ${event.title}`);

  const targetMembers = await getTargetGuildMembers(client);
  if (targetMembers.size === 0) {
    console.log(`[Notification Service] Không tìm thấy member nào có Role ${NOTIFICATION_CONFIG.TARGET_ROLE_ID}`);
    return { total: 0, sent: 0, failed: 0 };
  }

  // Lấy danh sách đã vote
  const attendances = await Attendance.find({ eventId: event.messageId }).lean();
  const votedUserIds = new Set(attendances.map((a) => a.userId));

  // Lọc member có role nhưng CHƯA vote
  const unvotedMembers = Array.from(targetMembers.values()).filter((m) => !votedUserIds.has(m.id));

  console.log(`[Notification Service] Tổng số member có role: ${targetMembers.size}, Đã vote: ${votedUserIds.size}, Chưa vote: ${unvotedMembers.length}`);

  let sent = 0;
  let failed = 0;
  const embed = buildUnvotedReminderEmbed({ event, milestoneHours });

  for (const member of unvotedMembers) {
    const result = await sendDirectMessage(client, member.id, { embeds: [embed] });
    if (result.success) sent++;
    else failed++;
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành nhắc chưa điểm danh: Đã gửi ${sent}/${unvotedMembers.length} (Lỗi: ${failed})`);
  return { total: unvotedMembers.length, sent, failed };
}

/**
 * Yêu cầu 2: Gửi thông báo xếp đội hình & kỹ năng khi Lưu trên Web
 */
async function notifyLineupAssignment(client, eventId, lineupData) {
  console.log(`[Notification Service] 🚀 Xử lý gửi thông báo xếp đội hình cho eventId: ${eventId}`);

  const event = await Event.findOne({ messageId: eventId }).lean();
  const divisions = lineupData?.divisions || [];
  const targetMembers = await getTargetGuildMembers(client);

  const assignments = []; // { userId, divisionName, teamName, slotIndex, roleName, note, skills }

  divisions.forEach((div) => {
    const divName = div.divisionName || 'Đoàn';
    (div.teams || []).forEach((team) => {
      const teamName = team.teamName || 'Team';
      (team.slots || []).forEach((slot, sIdx) => {
        if (slot.userId) {
          // Kiểm tra xem user có thuộc role mục tiêu không
          if (targetMembers.has(slot.userId)) {
            assignments.push({
              userId: slot.userId,
              divisionName: divName,
              teamName: teamName,
              slotIndex: sIdx,
              roleName: slot.roleName || slot.role || '',
              note: slot.note || '',
              skills: slot.skills || [],
            });
          }
        }
      });
    });
  });

  console.log(`[Notification Service] Tìm thấy ${assignments.length} thành viên có role được xếp đội hình.`);

  let sent = 0;
  let failed = 0;

  for (const item of assignments) {
    const embed = buildLineupAssignmentEmbed({
      event,
      divisionName: item.divisionName,
      teamName: item.teamName,
      slotIndex: item.slotIndex,
      roleName: item.roleName,
      note: item.note,
      skills: item.skills,
    });

    const result = await sendDirectMessage(client, item.userId, { embeds: [embed] });
    if (result.success) sent++;
    else failed++;
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành gửi thông báo đội hình: ${sent}/${assignments.length} (Lỗi: ${failed})`);
  return { total: assignments.length, sent, failed };
}

/**
 * Yêu cầu 3: Gửi thông báo nhắc vào game trước 30 phút
 */
async function notifyGameStartingSoon(client, event, minutesLeft = 30) {
  if (!event || !event.messageId) return { total: 0, sent: 0, failed: 0 };

  console.log(`[Notification Service] 🚀 Gửi thông báo chuẩn bị vào game (30p) cho event: ${event.title}`);

  const targetMembers = await getTargetGuildMembers(client);
  // Lấy những người đã vote thành công (present, bench, late)
  const attendances = await Attendance.find({
    eventId: event.messageId,
    status: { $in: ['present', 'bench', 'late'] },
  }).lean();

  const activeVotedMembers = attendances
    .filter((a) => targetMembers.has(a.userId))
    .map((a) => a.userId);

  console.log(`[Notification Service] Số thành viên đã vote tham gia & có role: ${activeVotedMembers.length}`);

  let sent = 0;
  let failed = 0;
  const embed = buildGameStartingSoonEmbed({ event, minutesLeft });

  for (const userId of activeVotedMembers) {
    const result = await sendDirectMessage(client, userId, { embeds: [embed] });
    if (result.success) sent++;
    else failed++;
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành nhắc vào game 30p: ${sent}/${activeVotedMembers.length} (Lỗi: ${failed})`);
  return { total: activeVotedMembers.length, sent, failed };
}

/**
 * Yêu cầu 4: Gửi thông báo nhắc thành viên vote "Chưa chắc chắn" chốt trước 24h
 */
async function notifyTentativeMembers(client, event, hoursLeft = 24) {
  if (!event || !event.messageId) return { total: 0, sent: 0, failed: 0 };

  console.log(`[Notification Service] 🚀 Gửi nhắc chốt phiếu vote Chưa chắc chắn (24h) cho event: ${event.title}`);

  const targetMembers = await getTargetGuildMembers(client);
  const tentativeAttendances = await Attendance.find({
    eventId: event.messageId,
    status: 'tentative',
  }).lean();

  const targetTentativeUserIds = tentativeAttendances
    .filter((a) => targetMembers.has(a.userId))
    .map((a) => a.userId);

  console.log(`[Notification Service] Số thành viên vote Chưa chắc chắn có role: ${targetTentativeUserIds.length}`);

  let sent = 0;
  let failed = 0;
  const embed = buildTentativeConfirmEmbed({ event, hoursLeft });

  for (const userId of targetTentativeUserIds) {
    const result = await sendDirectMessage(client, userId, { embeds: [embed] });
    if (result.success) sent++;
    else failed++;
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành nhắc chốt vote: ${sent}/${targetTentativeUserIds.length} (Lỗi: ${failed})`);
  return { total: targetTentativeUserIds.length, sent, failed };
}

module.exports = {
  NOTIFICATION_CONFIG,
  getEventDateTime,
  sendDirectMessage,
  getTargetGuildMembers,
  // Embed Builders
  buildUnvotedReminderEmbed,
  buildLineupAssignmentEmbed,
  buildGameStartingSoonEmbed,
  buildTentativeConfirmEmbed,
  // High-Level Notification Handlers
  notifyUnvotedMembers,
  notifyLineupAssignment,
  notifyGameStartingSoon,
  notifyTentativeMembers,
};
