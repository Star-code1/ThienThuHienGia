const { EmbedBuilder } = require('discord.js');
const Attendance = require('../features/attendance/models/Attendance');
const Event = require('../features/attendance/models/Event');
const LineupNotification = require('../features/attendance/models/LineupNotification');

const NOTIFICATION_CONFIG = {
  TARGET_ROLE_ID: process.env.TARGET_ROLE_ID || '1438967271149146302',
  TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID || '1515709357856264212',
  REPORT_CHANNEL_ID: process.env.NOTIFICATION_REPORT_CHANNEL_ID || '1438974225154183219',
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
    const sentMsg = await user.send(payload);
    return { success: true, messageId: sentMsg?.id, channelId: sentMsg?.channelId };
  } catch (error) {
    // Error 50007: Cannot send messages to this user (DM disabled / bot blocked)
    console.warn(`[DM Service] Không thể gửi DM tới ${userId}: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * Chỉnh sửa tin nhắn riêng (DM) đã gửi trước đó cho một User ID
 */
async function editDirectMessage(client, userId, messageId, payload) {
  try {
    const user = await client.users.fetch(userId);
    if (!user) {
      console.warn(`[DM Service] Không tìm thấy user để sửa DM: ${userId}`);
      return { success: false, reason: 'User not found' };
    }
    const dmChannel = user.dmChannel || (await user.createDM());
    const message = await dmChannel.messages.fetch(messageId);
    if (!message) {
      return { success: false, reason: 'Message not found' };
    }
    const updatedMsg = await message.edit(payload);
    return { success: true, messageId: updatedMsg.id, channelId: updatedMsg.channelId };
  } catch (error) {
    console.warn(`[DM Service] Không thể sửa DM ${messageId} của ${userId}: ${error.message}`);
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
function buildLineupAssignmentEmbed({
  event,
  divisionName,
  divisionNote,
  teamName,
  teamNote,
  slotIndex,
  roleName,
  note,
  skills = [],
  teammates = [],
  currentUserId,
  isUpdate = false,
}) {
  const dateStr = event ? new Date(event.date).toLocaleDateString('vi-VN') : 'Sắp diễn ra';
  const eventTime = event ? event.time : '20:00';
  const eventTitle = event ? event.title : 'BANG CHIẾN THIÊN THƯ MÔN';

  const skillList = skills.length > 0
    ? skills.map((s) => `• **${s.name || s.id}**`).join('\n')
    : '• *Chưa có kỹ năng chỉ định riêng (sử dụng theo vai trò)*';

  // Định dạng danh sách đồng đội cùng đội (Requirement 3)
  let teammatesText = '*Chưa có thông tin đồng đội*';
  if (teammates && teammates.length > 0) {
    teammatesText = teammates.map((m) => {
      const isMe = m.userId && m.userId === currentUserId;
      const slotNum = `Vị trí ${m.slotIndex + 1}:`;

      if (!m.userId && !m.displayName) {
        return `• ${slotNum} *(Trống)*`;
      }

      const userTag = m.userId ? `<@${m.userId}>` : `**${m.displayName}**`;
      const classTag = m.className ? `[${m.className}]` : '';
      const roleTag = m.roleName ? `(${m.roleName})` : '';
      const noteTag = m.note ? `— 💬 *"${m.note}"*` : '';

      if (isMe) {
        return `👉 **${slotNum}** ${userTag} ${classTag} ${roleTag} 🌟 **[BẠN]** ${noteTag}`;
      }
      return `• **${slotNum}** ${userTag} ${classTag} ${roleTag} ${noteTag}`;
    }).join('\n');
  }

  const updateHeader = isUpdate
    ? `🔄 **THÔNG BÁO: VỊ TRÍ CỦA BẠN CÓ SỰ CẬP NHẬT!**\n> *Sơ đồ và phân công trận Bang Chiến đã được cập nhật mới nhất. Dưới đây là vị trí mới của bạn:*\n\n`
    : '';

  const embed = new EmbedBuilder()
    .setColor(isUpdate ? 0xF39C12 : 0x3498DB)
    .setAuthor({
      name: isUpdate
        ? '🔄 THIÊN THƯ HIỀN GIẢ - CẬP NHẬT VỊ TRÍ ĐỘI HÌNH 🔄'
        : '🛡️ THIÊN THƯ HIỀN GIẢ - PHÂN CÔNG ĐỘI HÌNH 🛡️',
    })
    .setTitle(`📋 ${eventTitle}`)
    .setDescription(
      `${DIVIDER}\n` +
      updateHeader +
      `Sơ đồ đội hình Bang Chiến đã được cập nhật. Dưới đây là vị trí và đồng đội của bạn:\n\n` +
      `> 🚩 **Đoàn:** \`${divisionName || 'Đoàn Chưa Đặt Tên'}\`\n` +
      `> ⚔️ **Đội:** \`${teamName || 'Team'}\` (Vị trí: **Số ${slotIndex + 1}**)\n` +
      `> 🗓️ **Thời gian:** \`${eventTime} - ${dateStr}\`\n` +
      `${DIVIDER}`
    )
    .addFields(
      {
        name: `👥 Danh Sách Đồng Đội Cùng Team (${teamName})`,
        value: teammatesText.slice(0, 1024),
        inline: false,
      },
      {
        name: '🔮 Kỹ Năng / Tuyệt Kỹ Yêu Cầu',
        value: skillList.slice(0, 1024),
        inline: false,
      },
      {
        name: '📝 Ghi Chú Cá Nhân',
        value: note ? `\`${note}\`` : '*Không có ghi chú*',
        inline: false,
      }
    );

  if (teamNote) {
    embed.addFields({
      name: `🚩 Ghi Chú Toàn Đội (${teamName})`,
      value: `\`${teamNote}\``.slice(0, 1024),
      inline: false,
    });
  }

  if (divisionNote) {
    embed.addFields({
      name: `📢 Ghi Chú Toàn Đoàn (${divisionName})`,
      value: `\`${divisionNote}\``.slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({
    text: isUpdate
      ? 'Thiên Thư Môn • Vị trí của bạn có sự cập nhật'
      : 'Thiên Thư Môn • Chúc toàn thể anh em bang chiến thắng lợi!',
  }).setTimestamp();

  return embed;
}

/**
 * Embed thông báo rút khỏi sơ đồ thi đấu chính (về dự bị)
 */
function buildUnassignedNoticeEmbed({ event }) {
  const dateStr = event ? new Date(event.date).toLocaleDateString('vi-VN') : 'Sắp diễn ra';
  const eventTime = event ? event.time : '20:00';
  const eventTitle = event ? event.title : 'BANG CHIẾN THIÊN THƯ MÔN';

  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setAuthor({ name: '⚠️ THIÊN THƯ HIỀN GIẢ - CẬP NHẬT ĐỘI HÌNH ⚠️' })
    .setTitle(`📋 ${eventTitle}`)
    .setDescription(
      `${DIVIDER}\n` +
      `🔄 **THÔNG BÁO: VỊ TRÍ CỦA BẠN CÓ SỰ CẬP NHẬT!**\n\n` +
      `Hiện tại đạo hữu đã được chuyển **ra khỏi sơ đồ đội hình thi đấu chính thức** (chuyển sang hàng chờ / dự bị).\n\n` +
      `> 🗓️ **Thời gian trận:** \`${eventTime} - ${dateStr}\`\n` +
      `> 📍 **Trạng thái hiện tại:** \`Dự bị / Đang chờ sắp xếp lại\`\n` +
      `${DIVIDER}\n\n` +
      `👉 Vui lòng sẵn sàng tiếp ứng hoặc theo dõi thông báo mới nhất từ Ban Quản Trị!`
    )
    .setFooter({ text: 'Thiên Thư Môn • Vị trí của bạn có sự cập nhật' })
    .setTimestamp();
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
 * Gửi phản hồi báo cáo kết quả gửi thông báo tới kênh chỉ định (Kênh ID: 1438974225154183219)
 */
async function sendNotificationReport(client, { typeTitle, eventTitle, total, sent, failed, detailsSummary = null, failedList = [] }) {
  try {
    const reportChannelId = NOTIFICATION_CONFIG.REPORT_CHANNEL_ID;
    let channel = client.channels.cache.get(reportChannelId);
    if (!channel) {
      channel = await client.channels.fetch(reportChannelId).catch(() => null);
    }

    if (!channel) {
      console.warn(`[Notification Report] Không thể tìm thấy kênh phản hồi có ID: ${reportChannelId}`);
      return;
    }

    const isAllSuccess = failed === 0;
    let descriptionText =
      `${DIVIDER}\n` +
      `> ⚔️ **Sự kiện:** \`${eventTitle || 'Bang Chiến Thiên Thư Môn'}\`\n` +
      `> 🎯 **Tổng số thành viên:** **${total}**\n`;

    if (detailsSummary) {
      descriptionText +=
        `> 🆕 **Gửi mới:** **${detailsSummary.sentNew || 0}**\n` +
        `> 🔄 **Đã cập nhật (sửa tin cũ):** **${detailsSummary.updated || 0}**\n` +
        `> ⏭️ **Không đổi (bỏ qua):** **${detailsSummary.skipped || 0}**\n` +
        (detailsSummary.unassigned > 0 ? `> ⚠️ **Rút khỏi đội hình:** **${detailsSummary.unassigned}**\n` : '');
    } else {
      descriptionText += `> ✅ **Đã gửi thành công:** **${sent}**\n`;
    }

    descriptionText +=
      `> ❌ **Gửi thất bại (Lỗi):** **${failed}**\n` +
      `${DIVIDER}`;

    const embed = new EmbedBuilder()
      .setColor(isAllSuccess ? 0x2ECC71 : (sent > 0 ? 0xF39C12 : 0xE74C3C))
      .setAuthor({ name: '📊 BÁO CÁO TIẾN ĐỘ THÔNG BÁO (NOTIFICATION FEEDBACK)' })
      .setTitle(`🔔 ${typeTitle}`)
      .setDescription(descriptionText)
      .setFooter({ text: 'Thiên Thư Môn • Hệ thống phản hồi thông báo' })
      .setTimestamp();

    if (failedList.length > 0) {
      const maxShow = 12;
      const displayFailures = failedList.slice(0, maxShow).map((f) => {
        const uMention = f.userId ? `<@${f.userId}>` : f.name || 'Thành viên';
        return `• ${uMention} (${f.name || f.userId}): \`${f.reason || 'DM bị khóa / lỗi'}\``;
      }).join('\n');

      const extra = failedList.length > maxShow ? `\n*...và ${failedList.length - maxShow} thành viên khác*` : '';

      embed.addFields({
        name: `⚠️ Chi Tiết Gửi Thất Bại (${failedList.length})`,
        value: `${displayFailures}${extra}`.slice(0, 1024),
        inline: false,
      });
    }

    await channel.send({ embeds: [embed] });
    console.log(`[Notification Report] 📨 Đã gửi phản hồi báo cáo tới kênh ${reportChannelId} (Sent: ${sent}, Failed: ${failed})`);
  } catch (err) {
    console.error(`[Notification Report] ❌ Lỗi khi gửi phản hồi tới kênh:`, err.message);
  }
}

/**
 * Yêu cầu 1: Gửi thông báo đến những người CHƯA điểm danh
 */
async function notifyUnvotedMembers(client, event, milestoneHours) {
  if (!event || !event.messageId) return { total: 0, sent: 0, failed: 0 };

  console.log(`[Notification Service] 🚀 Bắt đầu gửi nhắc chưa điểm danh (Mốc ${milestoneHours}h) cho event: ${event.title}`);

  const targetMembers = await getTargetGuildMembers(client);
  if (targetMembers.size === 0) {
    console.log(`[Notification Service] Không tìm thấy member nào có Role ${NOTIFICATION_CONFIG.TARGET_ROLE_ID}`);
    await sendNotificationReport(client, {
      typeTitle: `Nhắc Nhở Chưa Điểm Danh (Mốc ${milestoneHours}h)`,
      eventTitle: event.title,
      total: 0,
      sent: 0,
      failed: 0,
    });
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
  const failedList = [];
  const embed = buildUnvotedReminderEmbed({ event, milestoneHours });

  for (const member of unvotedMembers) {
    const result = await sendDirectMessage(client, member.id, { embeds: [embed] });
    if (result.success) {
      sent++;
    } else {
      failed++;
      failedList.push({
        userId: member.id,
        name: member.displayName || member.user?.username || member.id,
        reason: result.reason,
      });
    }
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành nhắc chưa điểm danh: Đã gửi ${sent}/${unvotedMembers.length} (Lỗi: ${failed})`);

  // Gửi phản hồi báo cáo tới kênh chỉ định
  await sendNotificationReport(client, {
    typeTitle: `Nhắc Nhở Chưa Điểm Danh (Mốc ${milestoneHours}h)`,
    eventTitle: event.title,
    total: unvotedMembers.length,
    sent,
    failed,
    failedList,
  });

  return { total: unvotedMembers.length, sent, failed };
}

const lineupProcessingLocks = new Map(); // eventId -> timestamp

/**
 * Yêu cầu 2: Gửi thông báo xếp đội hình & kỹ năng khi Lưu trên Web
 * - Lần đầu: Gửi thông báo DM mới với embed chi tiết.
 * - Khi có sự thay đổi: Sửa lại thông báo trước đó kèm text "Vị trí của bạn có sự cập nhật".
 * - Khi không đổi: Bỏ qua để tránh spam thành viên.
 * - Khi bị rút khỏi đội hình: Sửa lại thông báo báo trạng thái về dự bị.
 */
async function notifyLineupAssignment(client, eventId, lineupData) {
  console.log(`[Notification Service] 🚀 Xử lý gửi thông báo xếp đội hình cho eventId: ${eventId}`);

  const now = Date.now();
  const lastRun = lineupProcessingLocks.get(eventId) || 0;
  if (now - lastRun < 2000) {
    console.log(`[Notification Service] ⏳ Đang có lượt xử lý lineup vừa chạy cho event ${eventId}. Bỏ qua trùng lặp.`);
    return { total: 0, sent: 0, updated: 0, skipped: 0, failed: 0 };
  }
  lineupProcessingLocks.set(eventId, now);

  const event = await Event.findOne({ messageId: eventId }).lean();
  const divisions = lineupData?.divisions || [];
  const targetMembers = await getTargetGuildMembers(client);

  const assignments = [];

  divisions.forEach((div) => {
    const divName = div.divisionName || 'Đoàn';
    const divNote = div.note || '';

    (div.teams || []).forEach((team) => {
      const teamName = team.teamName || 'Team';
      const teamNote = team.note || '';

      // Thu thập thông tin toàn bộ slot trong team để làm danh sách đồng đội
      const teammates = (team.slots || []).map((slot, sIdx) => ({
        slotIndex: sIdx,
        userId: slot.userId || null,
        displayName: slot.displayName || '',
        className: slot.className || slot.class || '',
        roleName: slot.roleName || slot.role || '',
        note: slot.note || '',
      }));

      (team.slots || []).forEach((slot, sIdx) => {
        if (slot.userId) {
          // Kiểm tra xem user có thuộc role mục tiêu không
          if (targetMembers.has(slot.userId)) {
            assignments.push({
              userId: slot.userId,
              displayName: slot.displayName || targetMembers.get(slot.userId)?.displayName || '',
              divisionName: divName,
              divisionNote: divNote,
              teamName: teamName,
              teamNote: teamNote,
              slotIndex: sIdx,
              roleName: slot.roleName || slot.role || '',
              note: slot.note || '',
              skills: slot.skills || [],
              teammates,
            });
          }
        }
      });
    });
  });

  console.log(`[Notification Service] Tìm thấy ${assignments.length} thành viên có role được xếp đội hình.`);

  // Truy vấn lịch sử thông báo đã gửi cho event này
  const existingNotifications = await LineupNotification.find({ eventId });
  const notiMap = new Map(existingNotifications.map((n) => [n.userId, n]));

  let sentNew = 0;
  let updated = 0;
  let skipped = 0;
  let unassigned = 0;
  let failed = 0;
  const failedList = [];

  for (const item of assignments) {
    const prevNoti = notiMap.get(item.userId);
    const skillsHash = (item.skills || []).map((s) => (s.name || s.id || '').trim()).sort().join('|');
    const teammatesHash = (item.teammates || []).map((t) => `${t.slotIndex}:${t.userId || ''}:${t.displayName || ''}:${t.roleName || ''}:${t.className || ''}`).join(';');

    if (!prevNoti) {
      // 1. Chưa từng gửi DM trước đó -> Gửi tin nhắn mới
      const embed = buildLineupAssignmentEmbed({
        event,
        divisionName: item.divisionName,
        divisionNote: item.divisionNote,
        teamName: item.teamName,
        teamNote: item.teamNote,
        slotIndex: item.slotIndex,
        roleName: item.roleName,
        note: item.note,
        skills: item.skills,
        teammates: item.teammates,
        currentUserId: item.userId,
        isUpdate: false,
      });

      const result = await sendDirectMessage(client, item.userId, { embeds: [embed] });
      if (result.success && result.messageId) {
        sentNew++;
        await LineupNotification.create({
          eventId,
          userId: item.userId,
          messageId: result.messageId,
          channelId: result.channelId,
          divisionName: item.divisionName,
          divisionNote: item.divisionNote,
          teamName: item.teamName,
          teamNote: item.teamNote,
          slotIndex: item.slotIndex,
          roleName: item.roleName,
          note: item.note,
          skills: item.skills,
          skillsHash,
          teammatesHash,
          isAssigned: true,
          lastNotifiedAt: new Date(),
        }).catch((err) => console.warn(`[LineupNotification] Lỗi lưu DB:`, err.message));
      } else {
        failed++;
        failedList.push({
          userId: item.userId,
          name: item.displayName || item.userId,
          reason: result.reason || 'Send failed',
        });
      }
    } else {
      // 2. Đã từng gửi trước đó -> Kiểm tra xem vị trí hoặc thông tin có thay đổi không
      const hasChanged = !prevNoti.isAssigned ||
        prevNoti.divisionName !== item.divisionName ||
        prevNoti.teamName !== item.teamName ||
        prevNoti.slotIndex !== item.slotIndex ||
        prevNoti.roleName !== item.roleName ||
        (prevNoti.note || '') !== (item.note || '') ||
        (prevNoti.divisionNote || '') !== (item.divisionNote || '') ||
        (prevNoti.teamNote || '') !== (item.teamNote || '') ||
        prevNoti.skillsHash !== skillsHash ||
        prevNoti.teammatesHash !== teammatesHash;

      if (!hasChanged) {
        skipped++;
        console.log(`[Notification Service] ⏭️ ${item.displayName} (${item.userId}): Vị trí không đổi, giữ nguyên.`);
        continue;
      }

      console.log(`[Notification Service] 🔄 ${item.displayName} (${item.userId}): Vị trí có sự cập nhật, sửa lại thông báo trước đó...`);
      const embed = buildLineupAssignmentEmbed({
        event,
        divisionName: item.divisionName,
        divisionNote: item.divisionNote,
        teamName: item.teamName,
        teamNote: item.teamNote,
        slotIndex: item.slotIndex,
        roleName: item.roleName,
        note: item.note,
        skills: item.skills,
        teammates: item.teammates,
        currentUserId: item.userId,
        isUpdate: true,
      });

      const updatePayload = {
        content: '🔔 **Vị trí của bạn có sự cập nhật**',
        embeds: [embed],
      };

      let editResult = await editDirectMessage(client, item.userId, prevNoti.messageId, updatePayload);
      if (!editResult.success) {
        console.warn(`[Notification Service] Sửa DM cũ của ${item.userId} thất bại (${editResult.reason}), gửi DM mới...`);
        editResult = await sendDirectMessage(client, item.userId, updatePayload);
      }

      if (editResult.success) {
        updated++;
        prevNoti.messageId = editResult.messageId || prevNoti.messageId;
        prevNoti.channelId = editResult.channelId || prevNoti.channelId;
        prevNoti.divisionName = item.divisionName;
        prevNoti.divisionNote = item.divisionNote;
        prevNoti.teamName = item.teamName;
        prevNoti.teamNote = item.teamNote;
        prevNoti.slotIndex = item.slotIndex;
        prevNoti.roleName = item.roleName;
        prevNoti.note = item.note;
        prevNoti.skills = item.skills;
        prevNoti.skillsHash = skillsHash;
        prevNoti.teammatesHash = teammatesHash;
        prevNoti.isAssigned = true;
        prevNoti.lastNotifiedAt = new Date();
        await prevNoti.save().catch((err) => console.warn(`[LineupNotification] Lỗi lưu update:`, err.message));
      } else {
        failed++;
        failedList.push({
          userId: item.userId,
          name: item.displayName || item.userId,
          reason: editResult.reason || 'Edit & fallback failed',
        });
      }
    }

    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  // 3. Xử lý các thành viên trước đó được xếp slot, nhưng lần lưu này bị rút ra khỏi đội hình
  const currentAssignedIds = new Set(assignments.map((a) => a.userId));
  for (const [prevUserId, prevNoti] of notiMap.entries()) {
    if (prevNoti.isAssigned && !currentAssignedIds.has(prevUserId)) {
      console.log(`[Notification Service] ⚠️ ${prevUserId}: Đã bị rút ra khỏi đội hình, sửa lại thông báo...`);
      const unassignedEmbed = buildUnassignedNoticeEmbed({ event });
      const unassignedPayload = {
        content: '🔔 **Vị trí của bạn có sự cập nhật**',
        embeds: [unassignedEmbed],
      };

      let editResult = await editDirectMessage(client, prevUserId, prevNoti.messageId, unassignedPayload);
      if (!editResult.success) {
        editResult = await sendDirectMessage(client, prevUserId, unassignedPayload);
      }

      if (editResult.success) {
        unassigned++;
        prevNoti.isAssigned = false;
        prevNoti.messageId = editResult.messageId || prevNoti.messageId;
        prevNoti.lastNotifiedAt = new Date();
        await prevNoti.save().catch((err) => console.warn(`[LineupNotification] Lỗi lưu unassigned:`, err.message));
      }
      await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
    }
  }

  console.log(`[Notification Service] ✅ Hoàn thành gửi thông báo đội hình: Mới: ${sentNew}, Cập nhật: ${updated}, Giữ nguyên: ${skipped}, Rút slot: ${unassigned}, Lỗi: ${failed}`);

  // Gửi phản hồi báo cáo tới kênh chỉ định
  await sendNotificationReport(client, {
    typeTitle: 'Thông Báo Phân Công Đội Hình Bang Chiến',
    eventTitle: event?.title || 'Sơ Đồ Trận Phái',
    total: assignments.length,
    sent: sentNew + updated,
    failed,
    detailsSummary: {
      sentNew,
      updated,
      skipped,
      unassigned,
    },
    failedList,
  });

  return { total: assignments.length, sent: sentNew, updated, skipped, unassigned, failed };
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
  const failedList = [];
  const embed = buildGameStartingSoonEmbed({ event, minutesLeft });

  for (const userId of activeVotedMembers) {
    const memberObj = targetMembers.get(userId);
    const result = await sendDirectMessage(client, userId, { embeds: [embed] });
    if (result.success) {
      sent++;
    } else {
      failed++;
      failedList.push({
        userId: userId,
        name: memberObj?.displayName || memberObj?.user?.username || userId,
        reason: result.reason,
      });
    }
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành nhắc vào game 30p: ${sent}/${activeVotedMembers.length} (Lỗi: ${failed})`);

  // Gửi phản hồi báo cáo tới kênh chỉ định
  await sendNotificationReport(client, {
    typeTitle: `Nhắc Chuẩn Bị Vào Trận (Trước ${minutesLeft} phút)`,
    eventTitle: event.title,
    total: activeVotedMembers.length,
    sent,
    failed,
    failedList,
  });

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
  const failedList = [];
  const embed = buildTentativeConfirmEmbed({ event, hoursLeft });

  for (const userId of targetTentativeUserIds) {
    const memberObj = targetMembers.get(userId);
    const result = await sendDirectMessage(client, userId, { embeds: [embed] });
    if (result.success) {
      sent++;
    } else {
      failed++;
      failedList.push({
        userId: userId,
        name: memberObj?.displayName || memberObj?.user?.username || userId,
        reason: result.reason,
      });
    }
    await sleep(NOTIFICATION_CONFIG.DELAY_BETWEEN_DMS_MS);
  }

  console.log(`[Notification Service] ✅ Hoàn thành nhắc chốt vote: ${sent}/${targetTentativeUserIds.length} (Lỗi: ${failed})`);

  // Gửi phản hồi báo cáo tới kênh chỉ định
  await sendNotificationReport(client, {
    typeTitle: `Nhắc Xác Nhận Phiếu Vote "Chưa Chắc Chắn" (Mốc ${hoursLeft}h)`,
    eventTitle: event.title,
    total: targetTentativeUserIds.length,
    sent,
    failed,
    failedList,
  });

  return { total: targetTentativeUserIds.length, sent, failed };
}

/**
 * Gửi noti ghi nhận việc ai đã sử dụng command gì về NOTIFICATION_REPORT_CHANNEL_ID
 */
async function logCommandUsage(client, interaction, error = null) {
  try {
    const reportChannelId = NOTIFICATION_CONFIG.REPORT_CHANNEL_ID;
    let channel = client.channels.cache.get(reportChannelId);
    if (!channel) {
      channel = await client.channels.fetch(reportChannelId).catch(() => null);
    }

    if (!channel) {
      console.warn(`[Command Logger] Không tìm thấy kênh report: ${reportChannelId}`);
      return;
    }

    // Format options nếu có
    const formatOptions = (optionsData) => {
      if (!optionsData || optionsData.length === 0) return '*(Không có)*';
      const lines = [];
      for (const opt of optionsData) {
        if (opt.value !== undefined) {
          lines.push(`• **${opt.name}**: \`${opt.value}\``);
        } else if (opt.options && opt.options.length > 0) {
          const sub = opt.options
            .map((s) => (s.value !== undefined ? `**${s.name}**: \`${s.value}\`` : s.name))
            .join(', ');
          lines.push(`• **${opt.name}** [${sub}]`);
        } else {
          lines.push(`• **${opt.name}**`);
        }
      }
      return lines.length > 0 ? lines.join('\n') : '*(Không có)*';
    };

    const optionsText = formatOptions(interaction.options?.data);
    const channelDisplay = interaction.guild
      ? `<#${interaction.channelId}>`
      : '💬 DM (Tin nhắn riêng)';

    const isSuccess = !error;
    const embed = new EmbedBuilder()
      .setColor(isSuccess ? 0x3498DB : 0xED4245)
      .setAuthor({
        name: `${interaction.user.tag} (${interaction.user.id})`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTitle(`⌨️ Sử Dụng Command: /${interaction.commandName}`)
      .setDescription(
        `${DIVIDER}\n` +
        `> 👤 **Người dùng:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n` +
        `> 📍 **Kênh:** ${channelDisplay}\n` +
        `> ⚡ **Lệnh:** \`/${interaction.commandName}\`\n` +
        `> 📊 **Trạng thái:** ${isSuccess ? '✅ Thành công' : '❌ Thất bại'}\n` +
        `${DIVIDER}`
      )
      .addFields(
        { name: '📝 Tham Số (Options)', value: optionsText.slice(0, 1024), inline: false }
      )
      .setFooter({ text: 'Thiên Thư Môn • Nhật Ký Hoạt Động Command' })
      .setTimestamp();

    if (error) {
      embed.addFields({
        name: '⚠️ Chi Tiết Lỗi',
        value: `\`\`\`${(error.message || error).toString().slice(0, 1000)}\`\`\``,
        inline: false,
      });
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[Command Logger] Lỗi khi gửi log command:', err.message);
  }
}

module.exports = {
  NOTIFICATION_CONFIG,
  getEventDateTime,
  sendDirectMessage,
  editDirectMessage,
  getTargetGuildMembers,
  sendNotificationReport,
  logCommandUsage,
  // Embed Builders
  buildUnvotedReminderEmbed,
  buildLineupAssignmentEmbed,
  buildUnassignedNoticeEmbed,
  buildGameStartingSoonEmbed,
  buildTentativeConfirmEmbed,
  // High-Level Notification Handlers
  notifyUnvotedMembers,
  notifyLineupAssignment,
  notifyGameStartingSoon,
  notifyTentativeMembers,
};

