const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { DIVIDER } = require('../constants');

/**
 * Xây dựng Embed xem điểm uy danh cá nhân
 */
function buildPersonalRankMessage({ userStat, totalRanked, totalEvents, targetUser }) {
  if (!userStat) {
    const emptyEmbed = new EmbedBuilder()
      .setColor(0x95A5A6)
      .setAuthor({ name: '⚔️ THIÊN THƯ MÔN - TRA CỨU ĐIỂM UY DANH ⚔️' })
      .setTitle('🔍 CHƯA CÓ DỮ LIỆU ĐIỂM DANH')
      .setDescription(
        `${DIVIDER}\n` +
        `Đạo hữu <@${targetUser.id}> chưa có dữ liệu xếp hạng trong hệ thống.\n\n` +
        `> 💡 **Lưu ý:** Bảng điểm công tội chỉ áp dụng cho đệ tử sở hữu role **Bang Chúng** trong các trận Bang Chiến thuộc kênh chỉ định.\n` +
        `${DIVIDER}`
      )
      .setFooter({ text: 'Thiên Thư Môn • Đạo pháp tự nhiên' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_view_bxh_top')
        .setLabel('🏆 Xem Bảng Xếp Hạng Top 3')
        .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [emptyEmbed], components: [row] };
  }

  const isPositive = userStat.reputationScore > 0;
  const isZero = userStat.reputationScore === 0;
  const scoreColor = isPositive ? 0x2ECC71 : (isZero ? 0xF39C12 : 0xE74C3C);
  const scoreSign = isPositive ? '+' : '';

  const embed = new EmbedBuilder()
    .setColor(scoreColor)
    .setAuthor({
      name: '⚔️ THIÊN THƯ MÔN - ĐIỂM UY DANH BANG CHIẾN ⚔️',
      iconURL: targetUser.displayAvatarURL?.() || undefined,
    })
    .setTitle(`📋 Hồ Sơ Công Tội: ${userStat.displayName}`)
    .setDescription(
      `${DIVIDER}\n` +
      `> 👤 **Đệ Tử:** <@${userStat.userId}> (\`${userStat.username}\`)\n` +
      `> ⚔️ **Môn Phái:** \`${userStat.className}\`\n` +
      `> 🏆 **Xếp Hạng:** **#${userStat.rank} / ${totalRanked}** đệ tử\n` +
      `> 💎 **Tổng Điểm Uy Danh:** **\`${scoreSign}${userStat.reputationScore} điểm\`**\n` +
      `${DIVIDER}`
    )
    .addFields(
      {
        name: '📊 Thống Kê Điểm Danh & Tham Chiến',
        value:
          `• ⚔️ **Tham chiến thực tế:** \`${userStat.attendedCount}\` trận *(+${userStat.attendedCount * 1.0}đ)*\n` +
          `• 🚫 **Cáo bận báo vắng:** \`${userStat.explicitAbsentCount}\` trận *(${userStat.explicitAbsentCount * -0.5}đ)*\n` +
          `• ⏳ **Không tham gia vote:** \`${userStat.unvotedCount}\` trận *(${userStat.unvotedCount * -2.0}đ)*\n` +
          `• 🚨 **Bỏ trận (Vote không đánh):** \`${userStat.noShowCount}\` trận *(${userStat.noShowCount * -3.0}đ)*\n` +
          `• ⚖️ **Chưa chắc chắn:** \`${userStat.tentativeCount}\` trận *(0đ)*`,
        inline: false,
      },
      {
        name: '📈 Tỷ Lệ Tham Chiến & Chuyên Cần',
        value:
          `> 🎯 **Tổng sự kiện áp dụng:** **${userStat.totalEvents}** / ${totalEvents} sự kiện\n` +
          `> 🚫 **Tổng số trận vắng:** **${userStat.totalAbsentCount}** trận\n` +
          `> 📉 **Tỷ lệ vắng mặt:** **${userStat.absenceRate}%**`,
        inline: false,
      },
      {
        name: '⚖️ Quy Tắc Tính Điểm Công Tội',
        value:
          `\`• Có mặt: +1.0đ\` | \`• Báo vắng: -0.5đ\`\n` +
          `\`• Không vote: -2.0đ\` | \`• Bỏ trận: -3.0đ\``,
        inline: false,
      }
    )
    .setFooter({ text: 'Thiên Thư Môn • Uy danh tạo nên sức mạnh' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_view_bxh_top')
      .setLabel('🏆 Xem Bảng Xếp Hạng Top 3')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Xây dựng Embed Bảng Xếp Hạng Top 3 Cao Nhất & Thấp Nhất
 */
function buildLeaderboardMessage({ topHigh, topLow, totalEvents, totalRanked }) {
  const medalIcons = ['👑', '🥈', '🥉'];
  const warningIcons = ['🚨', '⚠️', '⚠️'];

  const highListText = topHigh && topHigh.length > 0
    ? topHigh.map((m, idx) => {
        const medal = medalIcons[idx] || `#${idx + 1}`;
        const scoreStr = m.reputationScore > 0 ? `+${m.reputationScore}` : `${m.reputationScore}`;
        return (
          `**${medal} #${idx + 1}. <@${m.userId}>** (\`${m.displayName}\`)\n` +
          `> ⚔️ Phái: \`${m.className}\` • **Điểm: \`${scoreStr}đ\`**\n` +
          `> 📊 Đánh: \`${m.attendedCount}\` trận • Vắng: \`${m.totalAbsentCount}\` trận (Tỷ lệ vắng: \`${m.absenceRate}%\`)`
        );
      }).join('\n\n')
    : '*Chưa có dữ liệu xếp hạng cao*';

  const lowListText = topLow && topLow.length > 0
    ? topLow.map((m, idx) => {
        const icon = warningIcons[idx] || `#${idx + 1}`;
        return (
          `**${icon} #${idx + 1}. <@${m.userId}>** (\`${m.displayName}\`)\n` +
          `> ⚔️ Phái: \`${m.className}\` • **Điểm: \`${m.reputationScore}đ\`**\n` +
          `> 🚫 Không vote: \`${m.unvotedCount}\` • Bỏ trận: \`${m.noShowCount}\` • Báo vắng: \`${m.explicitAbsentCount}\``
        );
      }).join('\n\n')
    : '*Chưa có dữ liệu xếp hạng thấp*';

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setAuthor({ name: '🏆 THIÊN THƯ MÔN - BẢNG XẾP HẠNG UY DANH BANG CHIẾN 🏆' })
    .setTitle('📊 PHÂN BỔ ĐIỂM CÔNG TỘI & BẢNG PHONG THẦN')
    .setDescription(
      `${DIVIDER}\n` +
      `Bảng xếp hạng hiệu suất tham chiến công bằng dựa trên lịch sử điểm danh.\n\n` +
      `> ⚔️ **Tổng sự kiện xét duyệt:** **${totalEvents}** trận chiến\n` +
      `> 👥 **Tổng đệ tử xếp hạng:** **${totalRanked}** thành viên\n` +
      `${DIVIDER}`
    )
    .addFields(
      {
        name: '🌟 TOP 3 ĐẠI CÔNG THẦN (ĐIỂM CAO NHẤT)',
        value: highListText,
        inline: false,
      },
      {
        name: '🚨 TOP 3 CẦN CẢI THIỆN CHUYÊN CẦN (ĐIỂM THẤP NHẤT)',
        value: lowListText,
        inline: false,
      },
      {
        name: '⚖️ Công Thức Tính Điểm',
        value:
          `\`• Có mặt: +1.0đ\` | \`• Báo vắng: -0.5đ\`\n` +
          `\`• Không vote: -2.0đ\` | \`• Vote không đánh: -3.0đ\``,
        inline: false,
      }
    )
    .setFooter({ text: 'Thiên Thư Môn • Công tội phân minh, thưởng phạt rõ ràng' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_view_my_rank')
      .setLabel('👤 Xem Điểm Của Tôi')
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  buildPersonalRankMessage,
  buildLeaderboardMessage,
};
