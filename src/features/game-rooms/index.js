// /banchoi — liệt kê mọi bàn chơi đang mở trong kênh (Xì Dách, Bầu Cua, Poker...).
// Mỗi feature game tự khai báo `listRooms(channelId)`; loader gom vào client.roomListers.
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const MAX_ROOMS_SHOWN = 15;

const banChoiCommand = {
    data: new SlashCommandBuilder()
        .setName('banchoi')
        .setDescription('🎰 Xem các bàn Xì Dách, Bầu Cua, Poker đang mở trong kênh này'),
    async execute(interaction) {
        const rooms = [];
        for (const { name, fn } of interaction.client.roomListers || []) {
            try {
                rooms.push(...fn(interaction.channelId));
            } catch (err) {
                console.error(`❌ [banchoi] listRooms lỗi (${name}):`, err);
            }
        }

        if (!rooms.length) {
            return interaction.reply({
                content: '🍃 Kênh này chưa có bàn nào đang mở. Mở bàn mới bằng `/xidach`, `/baucua` hoặc `/poker`!',
                flags: 64,
            });
        }

        // Bàn còn vào được lên trước
        rooms.sort((a, b) => Number(b.joinable) - Number(a.joinable));
        const lines = rooms.slice(0, MAX_ROOMS_SHOWN).map((r) => {
            const title = r.url ? `[${r.title}](${r.url})` : r.title;
            return `${r.game} · **${title}** ${r.joinable ? '🟢' : '🔴'}\n└ ${r.detail}`;
        });
        if (rooms.length > MAX_ROOMS_SHOWN) lines.push(`… và ${rooms.length - MAX_ROOMS_SHOWN} bàn khác`);

        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle(`🎰 CÁC BÀN ĐANG MỞ TRONG KÊNH (${rooms.length})`)
            .setDescription(lines.join('\n\n'))
            .setFooter({ text: '🟢 còn vào được • 🔴 đang chơi/đủ người • Bấm tên bàn để nhảy tới' });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};

module.exports = {
    commands: [banChoiCommand],
};
