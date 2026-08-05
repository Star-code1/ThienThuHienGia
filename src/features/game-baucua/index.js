const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');

const LINH_THU = [
    { id: 'bau', name: 'Bầu (Lô Tháp)', emoji: '🍈' },
    { id: 'cua', name: 'Cua (Kim Quy)', emoji: '🦀' },
    { id: 'tom', name: 'Tôm (Linh Tôm)', emoji: '🦞' },
    { id: 'ca',  name: 'Cá (Thủy Tộc)', emoji: '🐟' },
    { id: 'ga',  name: 'Gà (Hoàng Yến)', emoji: '🐓' },
    { id: 'nai', name: 'Nai (Lộc Thần)', emoji: '🦌' },
];

// Active sessions for Bầu Cua: channelId -> gameSession
const activeBaucuaGames = new Map();

/**
 * Đặt đếm ngược 30 giây cho phiên Bầu Cua
 */
function startBaucuaTimer(channelId, channel) {
    const session = activeBaucuaGames.get(channelId);
    if (!session) return;

    if (session.timer) clearTimeout(session.timer);

    session.timer = setTimeout(async () => {
        const currentSession = activeBaucuaGames.get(channelId);
        if (!currentSession) return;

        activeBaucuaGames.delete(channelId);

        // Lắc 3 xúc xắc
        const diceResults = [
            LINH_THU[Math.floor(Math.random() * 6)],
            LINH_THU[Math.floor(Math.random() * 6)],
            LINH_THU[Math.floor(Math.random() * 6)],
        ];

        const diceNames = diceResults.map(d => `${d.emoji} ${d.name.split(' ')[0]}`);

        // Tính kết quả cho tất cả đạo hữu đã đặt cược
        let totalBetsAll = 0;
        let totalNetProfitAll = 0;
        let winnersSummary = [];

        for (const [userId, userBetObj] of Object.entries(currentSession.bets)) {
            const profile = await UserProfile.getOrCreate(userId, userBetObj.username);
            let userTotalBet = 0;
            let userTotalWin = 0;

            let betDetails = [];

            for (const [beastId, betAmount] of Object.entries(userBetObj.beastBets)) {
                if (betAmount <= 0) continue;
                userTotalBet += betAmount;
                totalBetsAll += betAmount;

                const matchCount = diceResults.filter(d => d.id === beastId).length;
                const beastObj = LINH_THU.find(b => b.id === beastId);

                if (matchCount > 0) {
                    const winAmount = betAmount * matchCount;
                    userTotalWin += (betAmount + winAmount); // Hoàn vốn + tiền thắng
                    betDetails.push(`${beastObj.emoji} ${beastObj.name.split(' ')[0]}: \`${betAmount}\` (Thắng x${matchCount} = +${winAmount} 💎)`);
                } else {
                    betDetails.push(`${beastObj.emoji} ${beastObj.name.split(' ')[0]}: \`${betAmount}\` (Thua)`);
                }
            }

            const netProfit = userTotalWin - userTotalBet;
            totalNetProfitAll += netProfit;

            profile.linhThach += netProfit;
            profile.stats.baucuaGames += 1;
            profile.stats.baucuaWinLinhThach += netProfit;
            await profile.save();

            const netStr = netProfit >= 0 ? `+${netProfit.toLocaleString()} 💎` : `${netProfit.toLocaleString()} 💎`;
            winnersSummary.push(`👤 **${userBetObj.username}**: Tổng cược \`${userTotalBet.toLocaleString()}\` 💎 ➔ **${netStr}**\n  └ ${betDetails.join('\n  └ ')}`);
        }

        // Lấy bình giải từ Groq AI
        const aiCommentary = await generateBaucuaCommentary(diceNames, totalBetsAll, totalNetProfitAll);

        const resultEmbed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🎲 KẾT QUẢ GIEO QUẺ BẦU CUA LỤC ĐẠI LINH THÚ 🎲')
            .setDescription(
                `🔮 **3 Đại Linh Thú giáng thế:**\n` +
                `>>> **${diceResults[0].emoji} ${diceResults[0].name}** | **${diceResults[1].emoji} ${diceResults[1].name}** | **${diceResults[2].emoji} ${diceResults[2].name}**\n\n` +
                (winnersSummary.length > 0 
                    ? `📊 **BẢNG KẾT QUẢ CÁC ĐẠO HỮU:**\n${winnersSummary.join('\n\n')}\n\n` 
                    : `⚠️ Không có đạo hữu nào tham gia đặt cược trong phiên này.\n\n`) +
                `💬 **Lời Quẻ Hiền Giả (Thiên Thư Môn):**\n*"${aiCommentary}"*`
            )
            .setFooter({ text: 'Thiên Thư Hiền Giả Ban Quẻ • Dùng /baucua để mở sòng mới' })
            .setTimestamp();

        await channel.send({ embeds: [resultEmbed] }).catch(() => {});
    }, 30000); // 30s đếm ngược
}

const baucuaCommand = {
    data: new SlashCommandBuilder()
        .setName('baucua')
        .setDescription('🎲 Khai mở sòng Bầu Cua 30s đếm ngược (Tùy chọn cược nhiều Linh Thú)'),
    async execute(interaction) {
        const channelId = interaction.channelId;

        if (activeBaucuaGames.has(channelId)) {
            return interaction.reply({
                content: '⚠️ Trong kênh này đang có sòng Bầu Cua đang đếm ngược 30s! Hãy chọn Linh Thú bên dưới để đặt cược.',
                flags: 64
            });
        }

        const session = {
            startTime: Date.now(),
            bets: {}, // userId -> { username, beastBets: { bau: 100, cua: 200... } }
            timer: null
        };

        activeBaucuaGames.set(channelId, session);

        // Row 1: First 3 beasts
        const row1 = new ActionRowBuilder().addComponents(
            LINH_THU.slice(0, 3).map(beast => 
                new ButtonBuilder()
                    .setCustomId(`bc_modal:${beast.id}`)
                    .setLabel(`${beast.emoji} ${beast.name.split(' ')[0]}`)
                    .setStyle(ButtonStyle.Primary)
            )
        );

        // Row 2: Next 3 beasts + Rules button
        const row2 = new ActionRowBuilder().addComponents(
            ...LINH_THU.slice(3, 6).map(beast => 
                new ButtonBuilder()
                    .setCustomId(`bc_modal:${beast.id}`)
                    .setLabel(`${beast.emoji} ${beast.name.split(' ')[0]}`)
                    .setStyle(ButtonStyle.Primary)
            ),
            new ButtonBuilder()
                .setCustomId('bc_rules')
                .setLabel('📖 Luật Chơi')
                .setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🎲 KHAI MỞ SÒNG BẦU CUA LỤC ĐẠI LINH THÚ 🎲')
            .setDescription(
                `🧙‍♂️ **Thiên Thư Hiền Giả** đã mở trận gieo xăm Bầu Cua tại Thiên Thư Môn!\n\n` +
                `⏱️ **Thời gian cược:** 30 giây đếm ngược!\n` +
                `👉 Bấm vào nút các **Linh Thú** bên dưới để nhập số Linh Thạch cược tùy ý (Có thể cược nhiều Linh Thú cùng lúc!).`
            )
            .setFooter({ text: 'Hết 30 giây Hiền Giả sẽ lắc 3 xúc xắc và trả thưởng!' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], components: [row1, row2] });

        // Khởi động đếm ngược 30s
        startBaucuaTimer(channelId, interaction.channel);
    }
};

// Interaction handler cho Bầu Cua
const handleBaucuaInteractions = async (interaction) => {
    const customId = interaction.customId;
    const channelId = interaction.channelId;

    if (customId === 'bc_rules') {
        const rulesEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('📖 LUẬT CHƠI BẦU CUA LỤC ĐẠI LINH THÚ')
            .setDescription(
                `🎲 **Quy tắc gieo quẻ:**\n` +
                `• Mỗi lượt chơi kéo dài 30 giây cho tất cả đạo hữu cùng tham gia đặt cược.\n` +
                `• Có 6 Linh Thú: Bầu 🍈, Cua 🦀, Tôm 🦞, Cá 🐟, Gà 🐓, Nai 🦌.\n` +
                `• Đạo hữu có thể chọn cược Linh Thạch vào một hoặc nhiều Linh Thú cùng lúc!\n\n` +
                `💰 **Trả thưởng:**\n` +
                `• Nếu 3 xúc xắc ra 1 con trùng khớp ➔ Hoàn tiền cược + Thưởng x1 tiền cược.\n` +
                `• Nếu ra 2 con trùng khớp ➔ Hoàn tiền cược + Thưởng x2 tiền cược.\n` +
                `• Nếu ra 3 con trùng khớp ➔ Hoàn tiền cược + Thưởng x3 tiền cược.\n` +
                `• Nếu không trúng ➔ Mất số Linh Thạch đã cược vào linh thú đó.`
            )
            .setFooter({ text: 'Thiên Thư Hiền Giả Ban Quẻ' });

        return interaction.reply({ embeds: [rulesEmbed], flags: 64 });
    }

    const session = activeBaucuaGames.get(channelId);

    if (!session) {
        return interaction.reply({ content: '⚠️ Ván Bầu Cua này đã hết giờ cược hoặc chưa khởi tạo. Dùng `/baucua` để mở sòng mới!', flags: 64 });
    }

    if (customId.startsWith('bc_modal:')) {
        const beastId = customId.split(':')[1];
        const beast = LINH_THU.find(b => b.id === beastId);

        const modal = new ModalBuilder()
            .setCustomId(`bc_submit:${beastId}`)
            .setTitle(`Đặt cược vào ${beast.emoji} ${beast.name.split(' ')[0]}`);

        const input = new TextInputBuilder()
            .setCustomId('bet_amount')
            .setLabel(`Số Linh Thạch cược vào ${beast.name}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Nhập số (Ví dụ: 100, 500, 2000...)')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(8);

        const firstActionRow = new ActionRowBuilder().addComponents(input);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
    }
};

// Modal Submit handler
const handleBaucuaModalSubmit = async (interaction) => {
    const customId = interaction.customId;
    const channelId = interaction.channelId;
    const session = activeBaucuaGames.get(channelId);

    if (!session) {
        return interaction.reply({ content: '⚠️ Ván Bầu Cua đã hết 30s đếm ngược!', flags: 64 });
    }

    if (customId.startsWith('bc_submit:')) {
        const beastId = customId.split(':')[1];
        const beast = LINH_THU.find(b => b.id === beastId);

        const amountStr = interaction.fields.getTextInputValue('bet_amount').trim();
        const betAmount = parseInt(amountStr, 10);

        if (isNaN(betAmount) || betAmount <= 0) {
            return interaction.reply({ content: '⚠️ Số Linh Thạch cược không hợp lệ!', flags: 64 });
        }

        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        // Tính tổng tiền cược hiện tại của user trong session
        if (!session.bets[interaction.user.id]) {
            session.bets[interaction.user.id] = { username: displayName, beastBets: {} };
        }
        session.bets[interaction.user.id].username = displayName;
        const userBetsObj = session.bets[interaction.user.id].beastBets;
        
        const currentTotalBet = Object.values(userBetsObj).reduce((a, b) => a + b, 0);
        const newTotalBet = currentTotalBet + betAmount;

        if (profile.linhThach < newTotalBet) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach.toLocaleString()}\` 💎, tổng cược yêu cầu: \`${newTotalBet.toLocaleString()}\` 💎.`,
                flags: 64
            });
        }

        userBetsObj[beastId] = (userBetsObj[beastId] || 0) + betAmount;

        await interaction.reply({
            content: `✅ **Thành công:** Đạo hữu **${displayName}** đã cược **${betAmount.toLocaleString()} Linh Thạch** vào **${beast.emoji} ${beast.name}**!\n` +
                     `💰 Tổng cược ván này của đạo hữu: \`${newTotalBet.toLocaleString()}\` Linh Thạch.`,
            flags: 64
        });
    }
};

module.exports = {
    commands: [baucuaCommand],
    interactions: {
        'bc_modal': handleBaucuaInteractions,
        'bc_rules': handleBaucuaInteractions,
        'bc_submit': handleBaucuaModalSubmit,
    }
};
