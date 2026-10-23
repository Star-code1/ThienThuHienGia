const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const Event = require('../models/Event');
const Lineup = require('../models/Lineup');
const Attendance = require('../models/Attendance');

const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

function formatEventDate(dateObj) {
  if (!dateObj) return 'Sắp diễn ra';
  const d = new Date(dateObj);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function buildTeammatesText(teammates, targetUserId) {
  if (!teammates || teammates.length === 0) {
    return '*Chưa có thông tin đồng đội*';
  }

  return teammates
    .map((m) => {
      const isTarget = m.userId && m.userId === targetUserId;
      const slotNum = `Vị trí ${m.slotIndex + 1}:`;

      if (!m.userId && !m.displayName) {
        return `• ${slotNum} *(Còn trống)*`;
      }

      const userTag = m.userId ? `<@${m.userId}>` : `**${m.displayName}**`;
      const classTag = m.className ? `[${m.className}]` : '';
      const roleTag = m.roleName ? `(${m.roleName})` : '';
      const noteTag = m.note ? `— 💬 *"${m.note}"*` : '';

      if (isTarget) {
        return `👉 **${slotNum}** ${userTag} ${classTag} ${roleTag} 🌟 **[BẠN]** ${noteTag}`;
      }
      return `• **${slotNum}** ${userTag} ${classTag} ${roleTag} ${noteTag}`;
    })
    .join('\n');
}

function buildSkillsText(skills) {
  if (!skills || skills.length === 0) {
    return '• *Chưa có kỹ năng/trang bị chỉ định riêng (sử dụng trang bị chuẩn theo phái)*';
  }
  return skills.map((s) => `• ⚡ **${s.name || s.id}**`).join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xemvitri')
    .setDescription('Xem vị trí, kỹ năng/trang bị & lưu ý của bạn trong trận Bang Chiến sắp tới')
    .addUserOption((opt) =>
      opt
        .setName('thanhvien')
        .setDescription('Chọn đệ tử cần xem vị trí (để trống sẽ xem của chính mình)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('sukien')
        .setDescription('Message ID của chiến kỳ cụ thể (mặc định: trận sắp tới gần nhất)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('congkhai')
        .setDescription('Hiển thị công khai trong kênh (mặc định: chỉ mình bạn thấy)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('congkhai') || false;
    await interaction.deferReply(isPublic ? {} : { flags: 64 });

    const targetUser = interaction.options.getUser('thanhvien') || interaction.user;
    const targetUserId = targetUser.id;
    const specifiedEventId = interaction.options.getString('sukien');

    // 1. Tìm trận Bang Chiến mục tiêu
    let event;
    if (specifiedEventId) {
      event = await Event.findOne({ messageId: specifiedEventId.trim() }).lean();
    } else {
      // Ưu tiên event có date >= hôm nay, sắp xếp theo thời gian sớm nhất
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      event = await Event.findOne({
        active: true,
        date: { $gte: startOfToday },
      })
        .sort({ date: 1, createdAt: -1 })
        .lean();

      if (!event) {
        // Fallback: Lấy event active mới nhất bất kỳ
        event = await Event.findOne({ active: true }).sort({ date: -1, createdAt: -1 }).lean();
      }
      if (!event) {
        // Fallback cuối: Lấy event mới nhất trong hệ thống
        event = await Event.findOne().sort({ createdAt: -1 }).lean();
      }
    }

    if (!event) {
      await interaction.editReply('❌ Hiện tại chưa có chiến kỳ / sự kiện Bang Chiến nào trong hệ thống.');
      return;
    }

    // 2. Lấy sơ đồ đội hình của event
    const lineup = await Lineup.findOne({ eventId: event.messageId }).lean();
    if (!lineup || !lineup.divisions || lineup.divisions.length === 0) {
      await interaction.editReply(
        `⚠️ Sự kiện **${event.title}** hiện chưa được Ban Chỉ Huy thiết lập sơ đồ đội hình.`
      );
      return;
    }

    // 3. Tìm vị trí của đệ tử trong sơ đồ
    let foundSlot = null;
    let foundTeam = null;
    let foundDivision = null;
    let teammates = [];

    for (const div of lineup.divisions || []) {
      for (const team of div.teams || []) {
        const currentTeammates = (team.slots || []).map((slot, sIdx) => ({
          slotIndex: sIdx,
          userId: slot.userId || null,
          displayName: slot.displayName || '',
          className: slot.className || slot.class || '',
          roleName: slot.roleName || slot.role || '',
          note: slot.note || '',
        }));

        for (let sIdx = 0; sIdx < (team.slots || []).length; sIdx++) {
          const slot = team.slots[sIdx];
          if (slot && slot.userId === targetUserId) {
            foundSlot = { ...slot, slotIndex: sIdx };
            foundTeam = team;
            foundDivision = div;
            teammates = currentTeammates;
            break;
          }
        }
        if (foundSlot) break;
      }
      if (foundSlot) break;
    }

    // Nút mở Web App
    const webUrl = process.env.WEB_URL || 'https://thienthuhiengia-web.onrender.com/lineup';
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('📜 Mở Sơ Đồ Toàn Quân (Web)')
        .setStyle(ButtonStyle.Link)
        .setURL(webUrl)
    );

    // 4. Trường hợp: Chưa có tên trong sơ đồ đội hình chính thức
    if (!foundSlot) {
      const att = await Attendance.findOne({
        eventId: event.messageId,
        userId: targetUserId,
      }).lean();

      let attInfo = '';
      if (att) {
        attInfo = `\n> 📊 **Trạng thái điểm danh:** \`${att.status || 'Đã vote'}\`${
          att.note ? ` — 💬 *"${att.note}"*` : ''
        }`;
      } else {
        attInfo = `\n> ⚠️ *Đệ tử chưa thực hiện điểm danh tham chiến sự kiện này.*`;
      }

      const notFoundEmbed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setAuthor({ name: '⚔️ THIÊN THƯ MÔN • THIÊN THƯ TRẬN PHÁI ⚔️' })
        .setTitle(`📋 ${event.title.toUpperCase()}`)
        .setDescription(
          `${DIVIDER}\n` +
            `Thành viên <@${targetUserId}> **chưa được xếp vào đội hình chính thức** trong trận Bang Chiến này.\n` +
            attInfo +
            '\n\n' +
            `> ℹ️ *Có thể bạn đang ở danh sách Dự Bị hoặc Ban Chỉ Huy đang trong quá trình điều chỉnh trận đồ.*\n` +
            `> 💬 *Vui lòng liên hệ Trưởng Đoàn hoặc Bang Chủ để được hướng dẫn chi tiết!*\n` +
            `${DIVIDER}`
        )
        .setFooter({ text: 'Thiên Thư Môn • Hệ thống Trận Phái Công Thành Chiến' })
        .setTimestamp();

      await interaction.editReply({ embeds: [notFoundEmbed], components: [actionRow] });
      return;
    }

    // 5. Trường hợp: Đã được xếp vị trí trong đội hình
    const embed = new EmbedBuilder()
      .setColor(0xd4af37) // Màu Hoàng Kim Thiên Thư
      .setAuthor({ name: '⚔️ THIÊN THƯ MÔN • THIÊN THƯ TRẬN PHÁI ⚔️' })
      .setTitle(`🛡️ VỊ TRÍ CHIẾN ĐẤU — ${event.title.toUpperCase()}`)
      .setDescription(
        `${DIVIDER}\n` +
          `> 👤 **Đệ tử:** <@${targetUserId}> (\`${targetUser.displayName || targetUser.username}\`)\n` +
          `> 🗓️ **Thời gian:** \`${event.time} — ${formatEventDate(event.date)}\`\n` +
          `> 🚩 **Quân Đoàn:** \`${foundDivision.divisionName || 'Đoàn Chưa Đặt Tên'}\`\n` +
          `> ⚔️ **Tiểu Đội:** \`${foundTeam.teamName || 'Team'}\` (Vị trí: **Số ${
            foundSlot.slotIndex + 1
          }**)\n` +
          `> 🥋 **Phái & Vai Trò:** \`${foundSlot.className || 'Tự do'}\` — \`${
            foundSlot.roleName || 'Tác chiến'
          }\`\n` +
          `${DIVIDER}`
      )
      .addFields(
        {
          name: `👥 Đồng Đội Cùng Tiểu Đội (${foundTeam.teamName || 'Team'})`,
          value: buildTeammatesText(teammates, targetUserId).slice(0, 1024),
          inline: false,
        },
        {
          name: '🔮 Kỹ Năng & Trang Bị / Tuyệt Kỹ Yêu Cầu',
          value: buildSkillsText(foundSlot.skills).slice(0, 1024),
          inline: false,
        },
        {
          name: '📝 Lưu Ý Của Bản Thân',
          value: foundSlot.note ? `💬 \`${foundSlot.note}\`` : '*Không có lưu ý riêng*',
          inline: false,
        }
      );

    if (foundTeam.note) {
      embed.addFields({
        name: `🚩 Lưu Ý Toàn Đội (${foundTeam.teamName})`,
        value: `💬 \`${foundTeam.note}\``.slice(0, 1024),
        inline: false,
      });
    }

    if (foundDivision.note) {
      embed.addFields({
        name: `📢 Hiệu Lệnh Toàn Đoàn (${foundDivision.divisionName})`,
        value: `💬 \`${foundDivision.note}\``.slice(0, 1024),
        inline: false,
      });
    }

    embed
      .setFooter({ text: 'Thiên Thư Môn • Trận Phái Công Thành Chiến' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed], components: [actionRow] });
  },
};
