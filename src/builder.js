const { EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Danh sách class (theo ảnh)
const CLASSES = [
  { label: 'Huyết Hà',   value: 'huyetHa',   emoji: '🐎' },
  { label: 'Cứu Linh',   value: 'cuuLinh',   emoji: '🔮' },
  { label: 'Tố Vấn',     value: 'toVan',     emoji: '❤️' },
  { label: 'Toái Mộng',  value: 'toaiMong',  emoji: '⚔️' },
  { label: 'Thiết Y',    value: 'thietY',    emoji: '🛡️' },
  { label: 'Long Ngâm',  value: 'longNgam',  emoji: '🐉' },
  { label: 'Thần Tương', value: 'thanTuong', emoji: '🎵' },
];

/**
 * Tạo embed + components cho một sự kiện điểm danh
 * @param {object} opts
 * @param {string} opts.title       - Tên sự kiện, vd "ĐIỂM DANH BANG CHIẾN 4/7"
 * @param {string} opts.date        - Ngày hiển thị, vd "4 July 2026"
 * @param {string} opts.time        - Giờ, vd "20:00"
 * @param {string} opts.eventId     - ID dùng trong customId
 * @param {object[]} opts.attendees - Mảng { displayName, className, status }
 * @param {number}  opts.totalSlots - Tổng slot (hiển thị "0" nếu chưa ai)
 */
function buildEventMessage(opts) {
  const { title, date, time, eventId, attendees = [], totalSlots = 0 } = opts;

  // Đếm theo status
  const present   = attendees.filter(a => a.status === 'present');
  const bench     = attendees.filter(a => a.status === 'bench');
  const late      = attendees.filter(a => a.status === 'late');
  const tentative = attendees.filter(a => a.status === 'tentative');
  const absent    = attendees.filter(a => a.status === 'absent');

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📋 ${title}`)
    .setDescription(
      '**Hướng dẫn báo danh**\n' +
      '• Click vào **Select Your Class** ➜ Chọn class của mình để điểm danh\n' +
      '• Nếu bận thì bấm **Vắng**'
    )
    .addFields(
      { name: '🗓️ Ngày', value: date, inline: true },
      { name: '🕗 Giờ',  value: time, inline: true },
      { name: '\u200B',  value: '\u200B', inline: true },
    );

  // Danh sách có mặt
  // Thống kê theo class
if (present.length > 0) {

  // Gom người theo class
  const grouped = {};

  CLASSES.forEach(c => {
    grouped[c.label] = [];
  });

  present.forEach(member => {
    if (!grouped[member.className]) {
      grouped[member.className] = [];
    }
    grouped[member.className].push(member.displayName);
  });

  // Tạo nội dung
  const classText = CLASSES
    .filter(c => grouped[c.label].length > 0)
    .map(c => {
      return `${c.emoji} **${c.label} (${grouped[c.label].length})**\n${grouped[c.label]
        .map(name => `• ${name}`)
        .join('\n')}`;
    })
    .join('\n\n');

  embed.addFields({
    name: `✅ Có mặt (${present.length})`,
    value: classText,
  });
}
  if (bench.length > 0) {
    embed.addFields({
      name: `🪑 Dự bị (${bench.length})`,
      value: bench.map(a => `• ${a.displayName}`).join('\n'),
    });
  }
  if (late.length > 0) {
    embed.addFields({
      name: `⏰ Muộn (${late.length})`,
      value: late.map(a => `• ${a.displayName}`).join('\n'),
    });
  }
  if (tentative.length > 0) {
    embed.addFields({
      name: `⚖️ Chưa chắc chắn (${tentative.length})`,
      value: tentative.map(a => `• ${a.displayName}`).join('\n'),
    });
  }
  if (absent.length > 0) {
    embed.addFields({
      name: `❌ Vắng (${absent.length})`,
      value: absent.map(a => `• ${a.displayName}`).join('\n'),
    });
  }

  embed.setFooter({ text: `Tổng điểm danh: ${present.length + bench.length + late.length + tentative.length}` });

  // Select menu chọn class
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_class:${eventId}`)
    .setPlaceholder('Select your class.')
    .addOptions(
      CLASSES.map(c =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setValue(c.value)
          .setEmoji(c.emoji)
      )
    );

  const row1 = new ActionRowBuilder().addComponents(selectMenu);

  // Buttons: Bench | Late | Tentative | Absence
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn_bench:${eventId}`).setLabel('Dự bị').setStyle(ButtonStyle.Secondary).setEmoji('🪑'),
    new ButtonBuilder().setCustomId(`btn_late:${eventId}`).setLabel('Muộn').setStyle(ButtonStyle.Secondary).setEmoji('⏰'),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`btn_tentative:${eventId}`).setLabel('Chưa chắc chắn').setStyle(ButtonStyle.Secondary).setEmoji('⚖️'),
    new ButtonBuilder().setCustomId(`btn_absent:${eventId}`).setLabel('Vắng').setStyle(ButtonStyle.Danger).setEmoji('❌'),
    new ButtonBuilder().setCustomId(`btn_cancel:${eventId}`).setLabel('Huỷ').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

module.exports = { CLASSES, buildEventMessage };
