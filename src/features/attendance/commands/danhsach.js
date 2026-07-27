const { SlashCommandBuilder } = require('discord.js');
const Event = require('../models/Event');
const Attendance = require('../models/Attendance');
const { statusLabel } = require('../../../shared/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('danhsach')
    .setDescription('Xem danh sách điểm danh của sự kiện')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message ID của sự kiện').setRequired(false)
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

    const attendees = await Attendance.find({ eventId: event.messageId });
    const lines = attendees.map(a => {
      const roleText = a.role ? ` | ${a.role}` : '';
      return `• **${a.displayName}** — ${a.className || '—'}${roleText} (${statusLabel(a.status)})`;
    });

    await interaction.editReply(
      `**${event.title}**\nTổng: ${attendees.length} người\n\n` +
      (lines.length ? lines.join('\n') : '_Chưa có ai điểm danh._')
    );
  },
};
