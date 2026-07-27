const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Event = require('../models/Event');
const Note = require('../models/Note');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ghichu')
    .setDescription('Xem tổng hợp ghi chú của sự kiện')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message ID của sự kiện (mặc định: sự kiện mới nhất)').setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const msgId = interaction.options.getString('message_id');
    const query = msgId ? { messageId: msgId } : { active: true };
    const event = await Event.findOne(query).sort({ createdAt: -1 });

    if (!event) {
      await interaction.editReply('❌ Không tìm thấy sự kiện nào.');
      return;
    }

    const notes = await Note.find({ eventId: event.messageId }).sort({ createdAt: 1 });

    if (notes.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0xE8A317)
        .setTitle('📝 Ghi chú')
        .setDescription(`**${event.title}**\n\n> _Chưa có ghi chú nào._\n> _Bấm nút_ 📝 **Ghi chú** _trên bảng điểm danh để thêm._`)
        .setTimestamp();
      await interaction.editReply({ embeds: [emptyEmbed] });
      return;
    }

    const lines = notes.map((n, i) => {
      const time = n.createdAt ? n.createdAt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }) : '—';
      return `> **${i + 1}.** ${n.content}\n> ╰ 👤 _${n.displayName}_ • 🕐 _${time}_`;
    });

    const noteEmbed = new EmbedBuilder()
      .setColor(0xE8A317)
      .setTitle('📝 Tổng hợp ghi chú')
      .setDescription(
        `**${event.title}**\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        lines.join('\n\n') +
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      )
      .setFooter({ text: `Tổng: ${notes.length} ghi chú` })
      .setTimestamp();

    await interaction.editReply({ embeds: [noteEmbed] });
  },
};
