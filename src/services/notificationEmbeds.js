const { EmbedBuilder } = require('discord.js');

const NOTIFICATION_CONFIG = {
  TARGET_CHANNEL_ID: process.env.TARGET_CHANNEL_ID || '1515709357856264212',
};

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

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

module.exports = {
  buildUnvotedReminderEmbed,
  buildLineupAssignmentEmbed,
  buildUnassignedNoticeEmbed,
  buildGameStartingSoonEmbed,
  buildTentativeConfirmEmbed,
};
