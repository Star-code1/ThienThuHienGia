const { PermissionsBitField, EmbedBuilder, Events } = require('discord.js');
const { TRAP_CHANNEL_ID, LOG_CHANNEL_ID } = require('../constants');

// Xóa tin nhắn trong 7 ngày qua (giới hạn tối đa của Discord API)
const DELETE_MESSAGE_SECONDS = 7 * 24 * 60 * 60; // 604800s = 7 ngày

module.exports = {
  name: Events.MessageCreate,
  once: false,

  async execute(message) {
    if (!message.guild) return;
    if (message.author.bot) return;

    // Bỏ qua Admin và bản thân bot
    if (
      message.member?.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) return;

    // Không phải kênh bẫy
    if (message.channel.id !== TRAP_CHANNEL_ID) return;

    console.log(`[TRAP TRIGGERED] User ${message.author.tag} (${message.author.id}) entered trap channel.`);

    const userTag = message.author.tag;
    const userId = message.author.id;
    const userAvatar = message.author.displayAvatarURL({ dynamic: true });

    let banSuccess = false;
    let banError = null;

    // 1. Thực hiện BAN NGAY LẬP TỨC kèm xóa toàn bộ tin nhắn 7 ngày qua trên toàn server
    try {
      await message.guild.members.ban(userId, {
        reason: '🚨 Kích hoạt kênh bẫy (Anti-Trap Honeypot / Spam Bot)',
        deleteMessageSeconds: DELETE_MESSAGE_SECONDS
      });
      banSuccess = true;
      console.log(`[TRAP BAN] Successfully banned ${userTag} and purged messages for the past 7 days.`);
    } catch (err) {
      banError = err.message || 'Lỗi không xác định';
      console.error(`[TRAP BAN ERROR] Failed to ban ${userTag}:`, err);
    }

    // 2. Gửi thông báo log về kênh LOG_CHANNEL_ID
    try {
      const logChannel = await message.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

      if (logChannel && logChannel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(banSuccess ? 'Red' : 'Orange')
          .setTitle(banSuccess ? '🚨 Kích Hoạt Kênh Bẫy — Đã Ban & Dọn Tin Nhắn' : '⚠️ Kích Hoạt Kênh Bẫy — Ban Thất Bại')
          .setThumbnail(userAvatar)
          .addFields(
            {
              name: '👤 Đối tượng',
              value: `**Tag:** ${userTag}\n**ID:** \`${userId}\`\n**Mention:** <@${userId}>`,
              inline: false
            },
            {
              name: '🔨 Hành động',
              value: banSuccess ? '✅ **Đã Ban vĩnh viễn**' : `❌ **Thất bại:** ${banError}`,
              inline: true
            },
            {
              name: '🗑 Dọn dẹp tin nhắn',
              value: banSuccess ? 'Toàn bộ tin trong **7 ngày** qua' : 'Chưa xóa',
              inline: true
            },
            {
              name: '📍 Kênh bẫy kích hoạt',
              value: `<#${TRAP_CHANNEL_ID}>`,
              inline: false
            }
          )
          .setFooter({ text: 'Hệ Thống Phòng Thủ Thiên Thư Môn' })
          .setTimestamp();

        await logChannel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('[TRAP LOG ERROR]', err);
    }
  },
};
