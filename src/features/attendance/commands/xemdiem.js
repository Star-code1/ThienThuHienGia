const { SlashCommandBuilder } = require('discord.js');
const { getGuildRankings } = require('../../../services/rankingService');
const { buildPersonalRankMessage } = require('../builders/rankingEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xemdiem')
    .setDescription('Tra cứu điểm uy danh công tội & xếp hạng bang chiến của bạn hoặc đệ tử khác')
    .addUserOption((opt) =>
      opt
        .setName('thanhvien')
        .setDescription('Chọn đệ tử cần tra cứu (để trống sẽ xem điểm của chính mình)')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('thanhvien') || interaction.user;

    const data = await getGuildRankings({ targetUserId: targetUser.id });

    const messagePayload = buildPersonalRankMessage({
      userStat: data.targetMember,
      totalRanked: data.totalMembers,
      totalEvents: data.totalEvents,
      targetUser,
    });

    await interaction.editReply(messagePayload);
  },
};
