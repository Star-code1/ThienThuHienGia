const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');

const tuviCommand = {
    data: new SlashCommandBuilder()
        .setName('tuvi')
        .setDescription('📜 Xem hồ sơ tu sĩ, Linh thạch, Tu vi và Cảnh giới của đạo hữu')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('Đạo hữu cần xem hồ sơ')
                .setRequired(false)
        ),
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const displayName = getDisplayName(interaction, targetUser);
        const profile = await UserProfile.getOrCreate(targetUser.id, displayName);

        const embed = new EmbedBuilder()
            .setColor('#D4AF37')
            .setTitle(`📜 Hồ Sơ Tu Tiên • ${displayName}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '✨ Cảnh Giới', value: `**${profile.canhGioi}**`, inline: true },
                { name: '🌌 Tu Vi (XP)', value: `\`${profile.tuVi.toLocaleString()}\` điểm`, inline: true },
                { name: '💎 Linh Thạch', value: `\`${profile.linhThach.toLocaleString()}\` viên`, inline: true },
                { 
                    name: '⚔️ Thống Kê Chiến Tích', 
                    value: `• **Nối Từ:** ${profile.stats.noituWins} trận thắng\n` +
                           `• **Vua Tiếng Việt:** ${profile.stats.vuatiengvietWins} câu đố\n` +
                           `• **Bầu Cua:** ${profile.stats.baucuaGames} lượt chơi (${profile.stats.baucuaWinLinhThach >= 0 ? '+' : ''}${profile.stats.baucuaWinLinhThach} 💎)\n` +
                           `• **Poker:** ${profile.stats.pokerWins}/${profile.stats.pokerGames} trận thắng`, 
                    inline: false 
                }
            )
            .setFooter({ text: 'Thiên Thư Môn • Đạo pháp tự nhiên', iconURL: interaction.client.user.displayAvatarURL() })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};

const diemdanhTuviCommand = {
    data: new SlashCommandBuilder()
        .setName('diemdanh-tuvi')
        .setDescription('🧘‍♂️ Báo danh tu luyện mỗi ngày để nhận Linh Thạch & Tu Vi'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);
        const now = new Date();

        if (profile.lastDiemDanh) {
            const last = new Date(profile.lastDiemDanh);
            const isSameDay = last.getFullYear() === now.getFullYear() &&
                             last.getMonth() === now.getMonth() &&
                             last.getDate() === now.getDate();

            if (isSameDay) {
                return interaction.reply({
                    content: `⚠️ Đạo hữu **${displayName}** hôm nay đã báo danh tu luyện rồi. Hãy quay lại vào ngày mai!`,
                    flags: 64
                });
            }
        }

        const bonusLinhThach = 500;
        const bonusTuVi = 100;

        profile.linhThach += bonusLinhThach;
        const oldRealm = profile.canhGioi;
        const newRealm = profile.addTuVi(bonusTuVi);
        profile.lastDiemDanh = now;
        await profile.save();

        let msg = `🧘‍♂️ **${displayName}** tiếp thu linh khí thiên địa!\n` +
                  `💎 Nhận thêm: **+${bonusLinhThach} Linh Thạch**\n` +
                  `🌌 Tu vi tăng: **+${bonusTuVi} Điểm**\n` +
                  `🔮 Cảnh giới hiện tại: **${newRealm}**`;

        if (oldRealm !== newRealm) {
            msg += `\n\n🎉 **CHÚC MỪNG ĐẠO HỮU ĐÃ ĐỘ KIẾP ĐỘT PHÁ CẢNH GIỚI LÊN [ ${newRealm} ]!** 🎉`;
        }

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🌟 Báo Danh Tu Luyện Thành Công')
            .setDescription(msg)
            .setFooter({ text: 'Thiên Thư Hiền Giả Ban Phước' });

        await interaction.reply({ embeds: [embed] });
    }
};

const topTuviCommand = {
    data: new SlashCommandBuilder()
        .setName('top-tuvi')
        .setDescription('🏆 Bảng xếp hạng các vị đại năng có Tu Vi cao nhất'),
    async execute(interaction) {
        const topProfiles = await UserProfile.find().sort({ tuVi: -1 }).limit(10);

        if (!topProfiles.length) {
            return interaction.reply('Hiện chưa có đạo hữu nào ghi danh trên bảng xếp hạng!');
        }

        let desc = topProfiles.map((p, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
            return `${medal} **${p.username}** — ${p.canhGioi} (\`${p.tuVi.toLocaleString()}\` Tu Vi | \`${p.linhThach.toLocaleString()}\` 💎)`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('🏆 Bảng Xếp Hạng ĐẠI NĂNG TU TIÊN')
            .setDescription(desc)
            .setFooter({ text: 'Thiên Thư Môn Phong Thần Bảng' });

        await interaction.reply({ embeds: [embed] });
    }
};

module.exports = {
    commands: [tuviCommand, diemdanhTuviCommand, topTuviCommand],
    interactions: {}
};
