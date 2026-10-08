const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Event = require('../models/Event');
const {
  NOTIFICATION_CONFIG,
  notifyUnvotedMembers,
  notifyTentativeMembers,
  notifyGameStartingSoon,
} = require('../../../services/notificationService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nhacdiemdanh')
    .setDescription('Gửi thông báo DM nhắc nhở thành viên có role tham gia bang chiến')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('loai')
        .setDescription('Loại thông báo cần gửi')
        .setRequired(true)
        .addChoices(
          { name: '📢 Nhắc những ai CHƯA điểm danh', value: 'unvoted' },
          { name: '⚖️ Nhắc những ai vote "Chưa chắc chắn" chốt phiếu', value: 'tentative' },
          { name: '⏰ Nhắc vào game (Dành cho người đã vote có mặt/dự bị)', value: 'starting_soon' }
        )
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const loai = interaction.options.getString('loai');

    // Lấy event mới nhất thuộc kênh cấu hình
    const event = await Event.findOne({
      channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID,
      active: true,
    }).sort({ createdAt: -1 });

    if (!event) {
      await interaction.editReply('❌ Không tìm thấy sự kiện bang chiến nào đang active trong kênh chỉ định.');
      return;
    }

    let res;
    if (loai === 'unvoted') {
      res = await notifyUnvotedMembers(client, event, 12);
      await interaction.editReply(
        `✅ Đã hoàn tất gửi DM nhắc **chưa điểm danh** cho sự kiện **${event.title}**:\n` +
        `• Tổng số người chưa vote có role: **${res.total}**\n` +
        `• Gửi thành công: **${res.sent}**\n` +
        `• Thất bại (do tắt DM/chặn): **${res.failed}**`
      );
    } else if (loai === 'tentative') {
      res = await notifyTentativeMembers(client, event, 24);
      await interaction.editReply(
        `✅ Đã hoàn tất gửi DM nhắc **chốt phiếu vote** cho sự kiện **${event.title}**:\n` +
        `• Tổng số người vote Chưa chắc chắn có role: **${res.total}**\n` +
        `• Gửi thành công: **${res.sent}**\n` +
        `• Thất bại (do tắt DM/chặn): **${res.failed}**`
      );
    } else if (loai === 'starting_soon') {
      res = await notifyGameStartingSoon(client, event, 30);
      await interaction.editReply(
        `✅ Đã hoàn tất gửi DM nhắc **chuẩn bị vào game 30p** cho sự kiện **${event.title}**:\n` +
        `• Tổng số người đã vote tham gia có role: **${res.total}**\n` +
        `• Gửi thành công: **${res.sent}**\n` +
        `• Thất bại (do tắt DM/chặn): **${res.failed}**`
      );
    }
  },
};
