const { EmbedBuilder } = require('discord.js');
const { voiceLinksText } = require('../shared/voiceChannels');

const NOTIFICATION_CONFIG = {
  TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID || '1515709357856264212',
};

// Bảng màu thống nhất cho mọi tin nhắn thông báo
const COLORS = {
  warn: 0xE67E22,    // cần hành động (chưa vote)
  info: 0x3498DB,    // thông tin đội hình
  update: 0xF1C40F,  // có thay đổi
  danger: 0xE74C3C,  // bị rút / lỗi
  go: 0x2ECC71,      // vào trận
  confirm: 0x9B59B6, // chốt phiếu
};

const FOOTER = 'Thiên Thư Môn • Thông báo tự động';
const VOTE_CHANNEL = () => `<#${NOTIFICATION_CONFIG.TARGET_CHANNEL_ID}>`;

const fmtDate = (event) => (event?.date ? new Date(event.date).toLocaleDateString('vi-VN') : 'Sắp diễn ra');
const fmtTime = (event) => event?.time || '20:00';
const eventTitle = (event, fallback) => event?.title || fallback;

/** 3 ô thông tin nằm ngang: Ngày • Giờ • (tùy chọn) Còn lại */
function timeFields(event, remaining) {
  const fields = [
    { name: '🗓️ Ngày', value: fmtDate(event), inline: true },
    { name: '🕗 Giờ', value: fmtTime(event), inline: true },
  ];
  if (remaining) fields.push({ name: '⏳ Còn lại', value: remaining, inline: true });
  return fields;
}

function baseEmbed({ color, author, title }) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: author })
    .setTitle(title)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

/**
 * 1. Nhắc chưa điểm danh
 */
function buildUnvotedReminderEmbed({ event, milestoneHours }) {
  return baseEmbed({
    color: COLORS.warn,
    author: 'Thiên Thư Môn • Nhắc điểm danh',
    title: `📢 ${eventTitle(event, 'Bang Chiến')}`,
  })
    .setDescription(
      'Đạo hữu **chưa điểm danh** cho trận sắp tới.\n' +
      `👉 Vào ${VOTE_CHANNEL()} bấm **Tham gia** hoặc **Báo vắng** để BQT kịp xếp đội hình.`
    )
    .addFields(timeFields(event, `~${milestoneHours} giờ`));
}

/** Một dòng đồng đội gọn gàng */
function formatTeammate(m, currentUserId) {
  const slot = `\`${String(m.slotIndex + 1).padStart(2, ' ')}\``;
  if (!m.userId && !m.displayName) return `${slot} *— trống —*`;

  const who = m.userId ? `<@${m.userId}>` : `**${m.displayName}**`;
  const meta = [m.className, m.roleName].filter(Boolean).join(' · ');
  const note = m.note ? ` — *${m.note}*` : '';
  const isMe = m.userId && m.userId === currentUserId;
  return `${slot} ${isMe ? '👉 ' : ''}${who}${meta ? ` · ${meta}` : ''}${isMe ? ' **(Bạn)**' : ''}${note}`;
}

/**
 * 2. Phân công đội hình & kỹ năng
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
  const team = teamName || 'Team';
  const embed = baseEmbed({
    color: isUpdate ? COLORS.update : COLORS.info,
    author: isUpdate ? 'Thiên Thư Môn • Vị trí đã thay đổi' : 'Thiên Thư Môn • Phân công đội hình',
    title: `📋 ${eventTitle(event, 'Bang Chiến Thiên Thư Môn')}`,
  })
    .setDescription(
      (isUpdate ? '🔄 **Vị trí của bạn vừa được cập nhật.** Xem lại bên dưới nhé!\n\n' : '') +
      `🕗 **${fmtTime(event)}** • ${fmtDate(event)}`
    )
    .addFields(
      { name: '🚩 Đoàn', value: divisionName || 'Chưa đặt tên', inline: true },
      { name: '⚔️ Đội', value: team, inline: true },
      { name: '📍 Vị trí', value: `Số ${slotIndex + 1}${roleName ? ` · ${roleName}` : ''}`, inline: true }
    );

  const teammatesText = teammates.length > 0
    ? teammates.map((m) => formatTeammate(m, currentUserId)).join('\n')
    : '*Chưa có thông tin đồng đội*';
  embed.addFields({ name: `👥 Đồng đội · ${team}`, value: teammatesText.slice(0, 1024) });

  const skillList = skills.length > 0
    ? skills.map((s) => `• ${s.name || s.id}`).join('\n')
    : '*Dùng kỹ năng theo vai trò*';
  embed.addFields({ name: '🔮 Kỹ năng yêu cầu', value: skillList.slice(0, 1024) });

  const notes = [
    note && `👤 **Bạn:** ${note}`,
    teamNote && `⚔️ **Đội:** ${teamNote}`,
    divisionNote && `🚩 **Đoàn:** ${divisionNote}`,
  ].filter(Boolean);
  if (notes.length > 0) {
    embed.addFields({ name: '📝 Ghi chú', value: notes.join('\n').slice(0, 1024) });
  }

  return embed;
}

/**
 * Rút khỏi đội hình chính (về dự bị)
 */
function buildUnassignedNoticeEmbed({ event }) {
  return baseEmbed({
    color: COLORS.danger,
    author: 'Thiên Thư Môn • Vị trí đã thay đổi',
    title: `📋 ${eventTitle(event, 'Bang Chiến Thiên Thư Môn')}`,
  })
    .setDescription(
      'Đạo hữu đã được chuyển **ra khỏi đội hình chính** → **Dự bị**.\n' +
      '👉 Hãy sẵn sàng tiếp ứng và theo dõi thông báo mới từ BQT.'
    )
    .addFields(timeFields(event));
}

/**
 * 3. Nhắc vào game trước giờ trận — kèm link voice từng cánh
 */
function buildGameStartingSoonEmbed({ event, minutesLeft = 30 }) {
  return baseEmbed({
    color: COLORS.go,
    author: 'Thiên Thư Môn • Chuẩn bị vào trận',
    title: `🔥 ${eventTitle(event, 'Bang Chiến')} — còn ${minutesLeft} phút!`,
  })
    .setDescription(
      '**Checklist trước trận**\n' +
      '✅ Mở game, buff đầy đủ, kiểm tra trang bị & kỹ năng\n' +
      '✅ Vào đúng phòng **Voice** theo cánh được phân\n' +
      '✅ Nghe hiệu lệnh Chỉ Huy'
    )
    .addFields(
      ...timeFields(event, `${minutesLeft} phút`),
      { name: '🔊 Voice team — bấm nút bên dưới là vào', value: voiceLinksText() }
    );
}

/**
 * 4. Nhắc chốt phiếu "Chưa chắc chắn"
 */
function buildTentativeConfirmEmbed({ event, hoursLeft = 24 }) {
  return baseEmbed({
    color: COLORS.confirm,
    author: 'Thiên Thư Môn • Xác nhận điểm danh',
    title: `⏳ ${eventTitle(event, 'Bang Chiến')}`,
  })
    .setDescription(
      'Đạo hữu đang để **Chưa chắc chắn**.\n' +
      `👉 Vào ${VOTE_CHANNEL()} chốt **Có mặt** hoặc **Báo vắng** để BQT khóa đội hình.`
    )
    .addFields(timeFields(event, `~${hoursLeft} giờ`));
}

module.exports = {
  COLORS,
  buildUnvotedReminderEmbed,
  buildLineupAssignmentEmbed,
  buildUnassignedNoticeEmbed,
  buildGameStartingSoonEmbed,
  buildTentativeConfirmEmbed,
};
