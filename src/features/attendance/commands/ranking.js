const { SlashCommandBuilder } = require('discord.js');
const { getGuildRankings } = require('../../../services/rankingService');
const { buildLeaderboardMessage } = require('../builders/rankingEmbeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Xem bảng xếp hạng uy danh Bang Chiến (Top 3 cao nhất & Top 3 thấp nhất tương tự Web)'),

  async execute(interaction) {
    await interaction.deferReply();

    const data = await getGuildRankings();

    const messagePayload = buildLeaderboardMessage({
      topHigh: data.topHigh,
      topLow: data.topLow,
      totalEvents: data.totalEvents,
      totalRanked: data.totalMembers,
    });

    await interaction.editReply(messagePayload);
  },
};
