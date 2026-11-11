const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Event = require('../models/Event');
const Attendance = require('../models/Attendance');
const Note = require('../models/Note');
const AbsenceNote = require('../models/AbsenceNote');
const User = require('../../../models/User');
const { TARGET_CHANNEL_ID, TARGET_ROLE_ID } = require('../../../services/rankingService');
const {
  createAbsenceStats,
  parseMonthKey,
  formatMonthLabel,
  WARNING_THRESHOLD,
  DANGER_THRESHOLD,
} = require('../../../services/absenceStats');
const { DIVIDER } = require('../constants');

const ROLE_DUONG_GIA = '1438965974345842768';
const ROLE_DUONG_CHU = '1438966724082012290';

const stats = createAbsenceStats({
  Event,
  Attendance,
  User,
  AbsenceNote,
  Note,
  channelId: TARGET_CHANNEL_ID,
  roleId: TARGET_ROLE_ID,
});

const LEVEL_ICON = { danger: '🚨', warning: '⚠️' };
const EMBED_DESC_LIMIT = 4000;

const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '—';

/** Cắt bớt danh sách dòng cho vừa giới hạn embed */
function fitLines(lines, limit = 1000) {
  const out = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    if (len + lines[i].length + 1 > limit) {
      out.push(`_… và ${lines.length - i} đệ tử khác (xem đầy đủ trên Web)_`);
      break;
    }
    out.push(lines[i]);
    len += lines[i].length + 1;
  }
  return out.join('\n');
}

function isLeader(interaction) {
  const roles = interaction.member?.roles?.cache;
  return Boolean(
    roles?.has(ROLE_DUONG_GIA) ||
    roles?.has(ROLE_DUONG_CHU) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}

function buildMonthEmbed(data) {
  const flagged = data.members.filter((m) => m.level);
  const others = data.members.filter((m) => !m.level && m.absentCount > 0);
  const color = data.dangerCount ? 0xE74C3C : data.warningCount ? 0xF39C12 : 0x2ECC71;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: '⚔️ THIÊN THƯ MÔN - THỐNG KÊ VẮNG THEO THÁNG ⚔️' })
    .setTitle(`📅 ${data.monthLabel}`)
    .setDescription(
      `${DIVIDER}\n` +
      `> ⚔️ **Số trận bang chiến:** \`${data.totalEvents}\`\n` +
      `> 🚫 **Tổng lượt vote Vắng:** \`${data.totalAbsentVotes}\` (${data.membersWithAbsence} đệ tử)\n` +
      `> ⏳ **Tổng lượt không vote:** \`${data.totalUnvoted}\`\n` +
      `> ⚠️ **Nhắc nhở (${WARNING_THRESHOLD} buổi):** \`${data.warningCount}\` • 🚨 **Cảnh cáo (≥${DANGER_THRESHOLD} buổi):** \`${data.dangerCount}\`\n` +
      `${DIVIDER}`
    )
    .setFooter({ text: 'Tính theo giờ Việt Nam • Chỉ tính kênh điểm danh bang chiến' })
    .setTimestamp();

  if (flagged.length) {
    const lines = flagged.map((m) => {
      const days = m.absentEvents.map((e) => fmtDay(e.date)).join(', ');
      let line = `${LEVEL_ICON[m.level]} <@${m.userId}> — **${m.absentCount} buổi** vắng (${days})`;
      if (m.unvotedCount) line += ` • ⏳ ${m.unvotedCount} không vote`;
      line += `\n╰ 📝 ${m.leaderNote ? `_${m.leaderNote.content}_ — ${m.leaderNote.updatedBy || 'Quản trị'}` : m.autoNote}`;
      return line;
    });
    embed.addFields({ name: `🚨 Đệ tử vắng từ ${WARNING_THRESHOLD} buổi trở lên (${flagged.length})`, value: fitLines(lines) });
  } else {
    embed.addFields({ name: '🎉 Không có đệ tử nào vắng từ 3 buổi trở lên', value: 'Bang chúng chuyên cần, tiếp tục phát huy!' });
  }

  if (others.length) {
    const lines = others.map((m) => `• ${m.displayName} — ${m.absentCount} buổi${m.unvotedCount ? ` • ⏳ ${m.unvotedCount} không vote` : ''}`);
    embed.addFields({ name: `🟡 Vắng 1–2 buổi (${others.length})`, value: fitLines(lines) });
  }

  return embed;
}

function buildMemberEmbed(data, user) {
  const m = data.members.find((x) => x.userId === user.id);
  const embed = new EmbedBuilder()
    .setAuthor({ name: '⚔️ THIÊN THƯ MÔN - THỐNG KÊ VẮNG CÁ NHÂN ⚔️', iconURL: user.displayAvatarURL?.() || undefined })
    .setTitle(`📅 ${data.monthLabel} — ${m?.displayName || user.username}`)
    .setFooter({ text: `Tháng có ${data.totalEvents} trận bang chiến` })
    .setTimestamp();

  if (!m || (m.absentCount === 0 && m.unvotedCount === 0)) {
    return embed.setColor(0x2ECC71).setDescription(`🎉 <@${user.id}> không vắng buổi nào trong ${data.monthLabel}.`);
  }

  const color = m.level === 'danger' ? 0xE74C3C : m.level === 'warning' ? 0xF39C12 : 0x3498DB;
  const eventLines = m.absentEvents.map((e) => {
    const reason = e.reasons.length ? `\n  ╰ 💬 _${e.reasons.join(' / ').slice(0, 150)}_` : '';
    return `• **${fmtDay(e.date)}** — ${e.title}${reason}`;
  });

  embed
    .setColor(color)
    .setDescription(
      `${DIVIDER}\n` +
      `> 👤 **Đệ tử:** <@${m.userId}> • \`${m.className}\`\n` +
      `> 🚫 **Vote Vắng:** \`${m.absentCount}\` buổi\n` +
      `> ⏳ **Không vote:** \`${m.unvotedCount}\` buổi\n` +
      (m.noShowCount ? `> 🚨 **Vote mà không đánh:** \`${m.noShowCount}\` buổi\n` : '') +
      `${DIVIDER}`
    );

  if (eventLines.length) embed.addFields({ name: '📋 Các buổi báo vắng', value: fitLines(eventLines) });
  if (m.autoNote) embed.addFields({ name: '📌 Đánh giá', value: m.autoNote });
  if (m.leaderNote) {
    embed.addFields({ name: `📝 Ghi chú của ${m.leaderNote.updatedBy || 'Quản trị'}`, value: m.leaderNote.content });
  }
  return embed;
}

function buildOverviewEmbed(rows) {
  const lines = rows
    .slice()
    .reverse()
    .map((r) => {
      const flags = [];
      if (r.warningCount) flags.push(`⚠️ ${r.warningCount}`);
      if (r.dangerCount) flags.push(`🚨 ${r.dangerCount}`);
      return (
        `**${r.monthLabel}** — ⚔️ ${r.totalEvents} trận • 🚫 ${r.totalAbsentVotes} lượt vắng (${r.membersWithAbsence} người)` +
        (flags.length ? ` • ${flags.join(' ')}` : '')
      );
    });

  return new EmbedBuilder()
    .setColor(0x3498DB)
    .setAuthor({ name: '⚔️ THIÊN THƯ MÔN - THỐNG KÊ VẮNG THEO TỪNG THÁNG ⚔️' })
    .setTitle(`📊 ${rows.length} tháng gần nhất`)
    .setDescription(`${DIVIDER}\n${lines.join('\n').slice(0, EMBED_DESC_LIMIT - 200)}\n${DIVIDER}\n⚠️ = số người vắng ${WARNING_THRESHOLD} buổi • 🚨 = số người vắng ≥${DANGER_THRESHOLD} buổi\nDùng \`/thongkevang thang\` để xem chi tiết từng tháng.`)
    .setTimestamp();
}

const monthOption = (opt) =>
  opt.setName('thang').setDescription('Tháng cần xem, ví dụ 11/2026 hoặc 2026-11 (mặc định: tháng này)').setRequired(false);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('thongkevang')
    .setDescription('Thống kê số lần vote Vắng bang chiến theo tháng')
    .addSubcommand((sub) =>
      sub
        .setName('thang')
        .setDescription('Chi tiết số lần vắng của đệ tử trong 1 tháng (đánh dấu người vắng 3–4 buổi)')
        .addStringOption(monthOption)
        .addUserOption((opt) => opt.setName('thanhvien').setDescription('Xem riêng 1 đệ tử').setRequired(false))
        .addBooleanOption((opt) => opt.setName('congkhai').setDescription('Hiển thị công khai trong kênh').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('tongquan')
        .setDescription('So sánh số lượt vắng giữa các tháng')
        .addIntegerOption((opt) =>
          opt.setName('sothang').setDescription('Số tháng gần nhất (mặc định 6)').setMinValue(1).setMaxValue(12).setRequired(false)
        )
        .addBooleanOption((opt) => opt.setName('congkhai').setDescription('Hiển thị công khai trong kênh').setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName('ghichu')
        .setDescription('(Đương Gia/Đường Chủ) Ghi chú cho đệ tử vắng nhiều trong tháng')
        .addUserOption((opt) => opt.setName('thanhvien').setDescription('Đệ tử cần ghi chú').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('noidung').setDescription('Nội dung ghi chú (nhập "xoa" để xoá)').setMaxLength(500).setRequired(true)
        )
        .addStringOption(monthOption)
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const isPublic = interaction.options.getBoolean('congkhai') ?? false;
    await interaction.deferReply(isPublic ? {} : { flags: 64 });

    if (sub === 'tongquan') {
      const months = interaction.options.getInteger('sothang') || 6;
      const rows = await stats.getMonthlyOverview({ months });
      await interaction.editReply({ embeds: [buildOverviewEmbed(rows)] });
      return;
    }

    const month = parseMonthKey(interaction.options.getString('thang'));
    if (!month) {
      await interaction.editReply('❌ Tháng không hợp lệ. Ví dụ: `11/2026` hoặc `2026-11`.');
      return;
    }

    if (sub === 'ghichu') {
      if (!isLeader(interaction)) {
        await interaction.editReply('❌ Chỉ **Đương Gia** hoặc **Đường Chủ** mới được ghi chú.');
        return;
      }
      const target = interaction.options.getUser('thanhvien');
      const raw = interaction.options.getString('noidung').trim();
      const note = await stats.setLeaderNote({
        month,
        userId: target.id,
        content: raw.toLowerCase() === 'xoa' ? '' : raw,
        updatedBy: interaction.member?.displayName || interaction.user.username,
      });
      await interaction.editReply(
        note
          ? `📝 Đã lưu ghi chú ${formatMonthLabel(month)} cho <@${target.id}>:\n> ${note.content}`
          : `🗑️ Đã xoá ghi chú ${formatMonthLabel(month)} của <@${target.id}>.`
      );
      return;
    }

    const data = await stats.getMonthlyDetail(month);
    const target = interaction.options.getUser('thanhvien');
    const embed = target ? buildMemberEmbed(data, target) : buildMonthEmbed(data);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
