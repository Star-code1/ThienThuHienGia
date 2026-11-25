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
                           `• **Poker:** ${profile.stats.pokerWins}/${profile.stats.pokerGames} trận thắng
` +
                           `• **Xì Dách:** ${profile.stats.blackjackWins || 0}/${profile.stats.blackjackGames || 0} ván thắng`, 
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

        // Chiếm lượt điểm danh nguyên tử: gửi lệnh 2 lần cùng lúc chỉ được nhận 1 lần
        const claimed = await UserProfile.updateOne(
            { userId: profile.userId, lastDiemDanh: profile.lastDiemDanh },
            { $set: { lastDiemDanh: now } }
        );
        if (claimed.modifiedCount === 0) {
            return interaction.reply({
                content: `⚠️ Đạo hữu **${displayName}** hôm nay đã báo danh tu luyện rồi. Hãy quay lại vào ngày mai!`,
                flags: 64
            });
        }
        profile.set('lastDiemDanh', now);
        profile.unmarkModified('lastDiemDanh');

        await profile.incLinhThach(bonusLinhThach);
        const oldRealm = profile.canhGioi;
        const newRealm = profile.addTuVi(bonusTuVi);
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

// Các bảng xếp hạng Linh Thạch / đánh bài
const LEADERBOARDS = {
    giau: {
        title: '💎 PHÚ HỘ THIÊN THƯ MÔN',
        sort: { linhThach: -1 },
        filter: {},
        line: (p) => `\`${p.linhThach.toLocaleString()}\` 💎`,
    },
    xidach: {
        title: '🃏 CAO THỦ XÌ DÁCH',
        sort: { 'stats.blackjackWins': -1, 'stats.blackjackGames': 1 },
        filter: { 'stats.blackjackGames': { $gt: 0 } },
        line: (p) => winRateLine(p.stats.blackjackWins, p.stats.blackjackGames),
    },
    poker: {
        title: '♠️ THẦN BÀI POKER',
        sort: { 'stats.pokerWins': -1, 'stats.pokerGames': 1 },
        filter: { 'stats.pokerGames': { $gt: 0 } },
        line: (p) => winRateLine(p.stats.pokerWins, p.stats.pokerGames),
    },
    noitu: {
        title: '🐲 NGUYÊN SOÁI NỐI TỪ',
        sort: { 'stats.noituWins': -1 },
        filter: { 'stats.noituWins': { $gt: 0 } },
        rankField: 'noituWins',
        line: (p) => '**' + p.stats.noituWins + '** từ nối đúng · kỷ lục chuỗi ' + (p.stats.noituBestStreak || 0),
    },
    noitu_chuoi: {
        title: '🔥 CHUỖI NỐI TỪ DÀI NHẤT',
        sort: { 'stats.noituBestStreak': -1, 'stats.noituWins': -1 },
        filter: { 'stats.noituBestStreak': { $gt: 0 } },
        rankField: 'noituBestStreak',
        line: (p) => streakLine(p.stats.noituBestStreak) + ' · ' + (p.stats.noituWins || 0) + ' từ đúng',
    },
    vua: {
        title: '👑 VUA TIẾNG VIỆT',
        sort: { 'stats.vuatiengvietWins': -1 },
        filter: { 'stats.vuatiengvietWins': { $gt: 0 } },
        rankField: 'vuatiengvietWins',
        line: (p) => '**' + p.stats.vuatiengvietWins + '** câu đúng · kỷ lục chuỗi ' + (p.stats.vuatiengvietBestStreak || 0),
    },
    vua_chuoi: {
        title: '🔥 CHUỖI THẮNG VUA TIẾNG VIỆT',
        sort: { 'stats.vuatiengvietBestStreak': -1, 'stats.vuatiengvietWins': -1 },
        filter: { 'stats.vuatiengvietBestStreak': { $gt: 0 } },
        rankField: 'vuatiengvietBestStreak',
        line: (p) => streakLine(p.stats.vuatiengvietBestStreak) + ' · ' + (p.stats.vuatiengvietWins || 0) + ' câu đúng',
    },
    baucua: {
        title: '🎲 ĐỔ VƯƠNG BẦU CUA',
        sort: { 'stats.baucuaWinLinhThach': -1 },
        filter: { 'stats.baucuaGames': { $gt: 0 } },
        line: (p) => {
            const net = p.stats.baucuaWinLinhThach || 0;
            return `\`${net >= 0 ? '+' : ''}${net.toLocaleString()}\` 💎 lãi ròng · ${p.stats.baucuaGames || 0} lượt`;
        },
    },
};

const streakLine = (n = 0) => '🔥 chuỗi **' + n + '** liên tiếp';

function winRateLine(wins = 0, games = 0) {
    const rate = games > 0 ? Math.round((wins / games) * 100) : 0;
    return `**${wins}** thắng / ${games} ván (${rate}%)`;
}

const topLinhThachCommand = {
    data: new SlashCommandBuilder()
        .setName('top-linhthach')
        .setDescription('💎 Bảng xếp hạng Linh Thạch và cao thủ các sòng bài')
        .addStringOption(option =>
            option.setName('bang')
                .setDescription('Chọn bảng xếp hạng (Mặc định: Phú hộ)')
                .setRequired(false)
                .addChoices(
                    { name: '💎 Phú hộ (nhiều Linh Thạch nhất)', value: 'giau' },
                    { name: '🃏 Xì Dách (thắng nhiều nhất)', value: 'xidach' },
                    { name: '♠️ Poker (thắng nhiều nhất)', value: 'poker' },
                    { name: '🎲 Bầu Cua (lãi ròng cao nhất)', value: 'baucua' },
                    { name: '🐲 Nối Từ (nối đúng nhiều nhất)', value: 'noitu' },
                    { name: '🔥 Nối Từ (chuỗi dài nhất)', value: 'noitu_chuoi' },
                    { name: '👑 Vua Tiếng Việt (đoán đúng nhiều nhất)', value: 'vua' },
                    { name: '🔥 Vua Tiếng Việt (chuỗi thắng dài nhất)', value: 'vua_chuoi' },
                )
        ),
    async execute(interaction) {
        const key = interaction.options.getString('bang') || 'giau';
        const board = LEADERBOARDS[key];
        const top = await UserProfile.find(board.filter).sort(board.sort).limit(10).lean();

        if (!top.length) {
            return interaction.reply('Hiện chưa có đạo hữu nào ghi danh trên bảng xếp hạng này!');
        }

        const desc = top.map((p, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
            p.stats = p.stats || {};
            p.linhThach = p.linhThach || 0;
            return `${medal} **${p.username}** — ${board.line(p)}`;
        }).join('\n');

        // Vị trí của người gọi lệnh (nếu không nằm trong top 10)
        let mine = '';
        const me = await UserProfile.findOne({ userId: interaction.user.id }).lean();
        if (me && !top.some(p => p.userId === me.userId)) {
            me.stats = me.stats || {};
            me.linhThach = me.linhThach || 0;
            // Hạng thật của người gọi lệnh trên các bảng game chữ (đếm số người đứng trên)
            let rankText = '';
            const myValue = board.rankField ? (me.stats[board.rankField] || 0) : 0;
            if (myValue > 0) {
                const ahead = await UserProfile.countDocuments({ ['stats.' + board.rankField]: { $gt: myValue } });
                rankText = '`#' + (ahead + 1) + '` ';
            }
            mine = '\n\n👤 **Đạo hữu:** ' + rankText + board.line(me);
        }

        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle(`🏆 ${board.title}`)
            .setDescription(desc + mine)
            .setFooter({ text: 'Thiên Thư Môn Phong Thần Bảng • /top-linhthach bang:<tên bảng>' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};

module.exports = {
    commands: [tuviCommand, diemdanhTuviCommand, topTuviCommand, topLinhThachCommand],
    interactions: {}
};
