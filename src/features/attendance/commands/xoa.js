const { SlashCommandBuilder } = require('discord.js');
const Event = require('../models/Event');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xoa')
    .setDescription('[ADMIN] Xoá/đóng sự kiện điểm danh')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message ID của sự kiện').setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    if (!interaction.member.permissions.has('ManageMessages')) {
      await interaction.editReply('❌ Bạn không có quyền xoá sự kiện.');
      return;
    }

    const msgId = interaction.options.getString('message_id');
    await Event.findOneAndUpdate({ messageId: msgId }, { active: false });
    await interaction.editReply(`✅ Đã đóng sự kiện \`${msgId}\`.`);
  },
};
