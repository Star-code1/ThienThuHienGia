const { getGuildRankings } = require('../../../services/rankingService');
const { buildPersonalRankMessage, buildLeaderboardMessage } = require('../builders/rankingEmbeds');

async function handleRankingButtons(interaction) {
  const customId = interaction.customId;

  if (customId === 'btn_view_bxh_top') {
    await interaction.deferReply({ ephemeral: true });

    const data = await getGuildRankings();
    const payload = buildLeaderboardMessage({
      topHigh: data.topHigh,
      topLow: data.topLow,
      totalEvents: data.totalEvents,
      totalRanked: data.totalMembers,
    });

    await interaction.editReply(payload);
  } else if (customId === 'btn_view_my_rank') {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.user;
    const data = await getGuildRankings({ targetUserId: targetUser.id });

    const payload = buildPersonalRankMessage({
      userStat: data.targetMember,
      totalRanked: data.totalMembers,
      totalEvents: data.totalEvents,
      targetUser,
    });

    await interaction.editReply(payload);
  }
}

module.exports = handleRankingButtons;
