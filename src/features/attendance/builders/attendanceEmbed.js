const { EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CLASSES, ROLES, DIVIDER } = require('../constants');

function progressBar(current, max = 60) {
  const filled = Math.min(current, max);
  const empty = max - filled;
  const pct = max > 0 ? Math.round((filled / max) * 100) : 0;
  const bar = '▰'.repeat(Math.min(filled, 15)) + '▱'.repeat(Math.max(15 - filled, 0));
  return `${bar}  **${filled}** / ${max} người (${pct}%)`;
}

function buildEventMessage(opts) {
  const { title, date, time, eventId, attendees = [], totalSlots = 60 } = opts;

  const present   = attendees.filter(a => a.status === 'present');
  const bench     = attendees.filter(a => a.status === 'bench');
  const late      = attendees.filter(a => a.status === 'late');
  const tentative = attendees.filter(a => a.status === 'tentative');
  const absent    = attendees.filter(a => a.status === 'absent');
  const totalActive = present.length + bench.length + late.length + tentative.length;

  const embed = new EmbedBuilder()
    .setColor(0xE8A317)
    .setAuthor({
      name: '⚔️ THIÊN THƯ HIỀN GIẢ ⚔️',
    })
    .setTitle(`\n${title}`)
    .setDescription(
      `${DIVIDER}\n` +
      `> 🗓️ **Ngày:**  \`${date}\`\n` +
      `> 🕗 **Giờ:**   \`${time}\`\n` +
      `${DIVIDER}\n\n` +
      `📊 **Tiến độ điểm danh**\n` +
      `${progressBar(totalActive, totalSlots)}\n\n` +
      `\`\`\`\n` +
      `  ✅ Có mặt: ${String(present.length).padStart(2)}    🪑 Dự bị:   ${String(bench.length).padStart(2)}\n` +
      `  ⏰ Muộn:   ${String(late.length).padStart(2)}    ⚖️ Chưa chắc: ${String(tentative.length).padStart(2)}\n` +
      `  ❌ Vắng:   ${String(absent.length).padStart(2)}\n` +
      `\`\`\``
    );

  if (present.length > 0) {
    const grouped = {};
    CLASSES.forEach(c => { grouped[c.label] = []; });

    present.forEach(member => {
      if (!grouped[member.className]) grouped[member.className] = [];
      grouped[member.className].push({ name: member.displayName, role: member.role });
    });

    const roleCounts = {};
    ROLES.forEach(r => { roleCounts[r.label] = 0; });
    present.forEach(m => { if (m.role && roleCounts[m.role] !== undefined) roleCounts[m.role]++; });

    const roleStats = ROLES
      .map(r => `${r.emoji} ${r.label}: **${roleCounts[r.label]}**`)
      .join('  │  ');

    embed.addFields({
      name: `✅ CÓ MẶT ── ${present.length}/${totalSlots}`,
      value: `📋 **Phân công:** ${roleStats}`,
      inline: false,
    });

    CLASSES.forEach(c => {
      if (grouped[c.label].length === 0) return;

      const members = grouped[c.label]
        .map(m => {
          const role = ROLES.find(r => r.label === m.role);
          return `• ${m.name}${role ? ` ${role.emoji} \`${role.label}\`` : ''}`;
        })
        .join('\n');

      embed.addFields({
        name: `${c.emoji} ${c.label} (${grouped[c.label].length}/20)`,
        value: members,
        inline: true,
      });
    });
  } else {
    embed.addFields({
      name: '✅ CÓ MẶT',
      value: '> _Chưa có ai điểm danh..._',
    });
  }

  const otherGroups = [
    { list: bench,     icon: '🪑', label: 'DỰ BỊ' },
    { list: late,      icon: '⏰', label: 'ĐẾN MUỘN' },
    { list: tentative, icon: '⚖️', label: 'CHƯA CHẮC CHẮN' },
    { list: absent,    icon: '❌', label: 'VẮNG MẶT' },
  ];

  const leftGroups = otherGroups.filter((_, i) => i < 2 && _.list.length > 0);
  const rightGroups = otherGroups.filter((_, i) => i >= 2 && _.list.length > 0);

  if (leftGroups.length > 0) {
    embed.addFields({
      name: '\u200B',
      value: leftGroups.map(g =>
        `${g.icon} **${g.label}** (\`${g.list.length}\`)\n` +
        g.list.map(a => ` ╰ ${a.displayName}`).join('\n')
      ).join('\n\n'),
      inline: true,
    });
  }

  if (rightGroups.length > 0) {
    embed.addFields({
      name: '\u200B',
      value: rightGroups.map(g =>
        `${g.icon} **${g.label}** (\`${g.list.length}\`)\n` +
        g.list.map(a => `╰ ${a.displayName}`).join('\n')
      ).join('\n\n'),
      inline: true,
    });
  }

  embed.addFields({
    name: '\u200B',
    value:
      `${DIVIDER}\n` +
      '📌 **Hướng dẫn báo danh**\n' +
      '> `1.` Chọn **class** ở menu bên dưới\n' +
      '> `2.` Chọn **nhiệm vụ** (Đánh trụ / Đánh người / Vật tư)\n' +
      '> `3.` Bấm 📝 **Ghi chú** nếu cần nhắn gì cho bang\n' +
      '> `4.` Nếu bận → bấm ❌ **Vắng**',
  });

  embed.setFooter({
    text: `📊 Tổng điểm danh: ${totalActive} người  •  ID: ${eventId}`,
  });
  embed.setTimestamp();

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_class:${eventId}`)
    .setPlaceholder('⚔️ Chọn class của bạn')
    .addOptions(
      CLASSES.map(c =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setValue(c.value)
          .setEmoji(c.emojiComponent)
      )
    );

  const row1 = new ActionRowBuilder().addComponents(selectMenu);

  const roleMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_role:${eventId}`)
    .setPlaceholder('🎯 Chọn nhiệm vụ')
    .addOptions(
      ROLES.map(r =>
        new StringSelectMenuOptionBuilder()
          .setLabel(r.label)
          .setValue(r.value)
          .setEmoji(r.emoji)
          .setDescription(
            r.value === 'danhTru'   ? 'Tập trung phá trụ đối thủ' :
            r.value === 'danhNguoi' ? 'PVP tiêu diệt địch' :
            'Thu thập & vận chuyển vật tư'
          )
      )
    );

  const rowRole = new ActionRowBuilder().addComponents(roleMenu);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn_bench:${eventId}`).setLabel('Dự bị').setStyle(ButtonStyle.Secondary).setEmoji('🪑'),
    new ButtonBuilder().setCustomId(`btn_late:${eventId}`).setLabel('Muộn').setStyle(ButtonStyle.Secondary).setEmoji('⏰'),
    new ButtonBuilder().setCustomId(`btn_note:${eventId}`).setLabel('Ghi chú').setStyle(ButtonStyle.Success).setEmoji('📝'),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn_tentative:${eventId}`).setLabel('Chưa chắc').setStyle(ButtonStyle.Secondary).setEmoji('⚖️'),
    new ButtonBuilder().setCustomId(`btn_absent:${eventId}`).setLabel('Vắng').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    new ButtonBuilder().setCustomId(`btn_cancel:${eventId}`).setLabel('Huỷ điểm danh').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
  );

  return { embeds: [embed], components: [row1, rowRole, row2, row3] };
}

module.exports = { buildEventMessage, progressBar };
