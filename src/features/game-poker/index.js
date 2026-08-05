const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const { createDeck, evaluate7Cards } = require('./pokerEngine');
const { generatePokerCommentary } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');

// Active poker games: userId -> gameSession
const pokerGames = new Map();

const pokerCommand = {
    data: new SlashCommandBuilder()
        .setName('poker')
        .setDescription('🃏 Quyết đấu Poker Hồng Trần 1v1 với Thiên Thư Hiền Giả')
        .addIntegerOption(option => 
            option.setName('cuoc')
                .setDescription('Mức Linh Thạch đặt cược (Mặc định: 200)')
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(20000)
        ),
    async execute(interaction) {
        const betAmount = interaction.options.getInteger('cuoc') || 200;
        const profile = await UserProfile.getOrCreate(interaction.user.id, interaction.user.username);

        if (profile.linhThach < betAmount) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach}\` 💎, cần cược: \`${betAmount}\` 💎.`,
                flags: 64
            });
        }

        const deck = createDeck();
        const playerCards = [deck.pop(), deck.pop()];
        const aiCards = [deck.pop(), deck.pop()];
        const communityCards = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];

        pokerGames.set(interaction.user.id, {
            betAmount,
            playerCards,
            aiCards,
            communityCards,
            stage: 'preflop',
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pk_next:${interaction.user.id}`)
                .setLabel('👀 Lật 3 Lá Flop')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('pk_rules')
                .setLabel('📖 Luật Chơi')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`pk_fold:${interaction.user.id}`)
                .setLabel('🏳️ Bỏ Bài (Fold)')
                .setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('🃏 HỒNG TRẦN POKER • ĐẤU VỚI HIỀN GIẢ 🃏')
            .setDescription(
                `⚔️ **Đạo Hữu vs Thiên Thư Hiền Giả**\n` +
                `💎 Mức cược: **\`${betAmount.toLocaleString()}\` Linh Thạch**\n\n` +
                `🎴 **Hai lá bài ẩn trên tay của đạo hữu:**\n` +
                `>>> 🃏 **\` [ ${playerCards[0].toString()} ]  [ ${playerCards[1].toString()} ] \`**\n\n` +
                `🎴 **Hai lá bài ẩn của Hiền Giả:**\n` +
                `>>> 🎴 **\` [ ❓ ]  [ ❓ ] \`**\n\n` +
                `🌐 **Lá bài chung trên bàn:** \`[ Chưa lật ]\``
            )
            .setFooter({ text: 'Bấm nút bên dưới để tiếp tục lượt lật bài' });

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};

const handlePokerButtons = async (interaction) => {
    const customId = interaction.customId;

    if (customId === 'pk_rules') {
        const rulesEmbed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('📖 LUẬT CHƠI HỒNG TRẦN POKER (TEXAS HOLD\'EM)')
            .setDescription(
                `🃏 **Quy tắc thi đấu 1v1:**\n` +
                `• Mỗi người chơi được chia 2 lá bài tẩy riêng.\n` +
                `• Lần lượt trải qua các vòng lật 5 lá bài chung: **Flop (3 lá)** ➔ **Turn (1 lá)** ➔ **River (1 lá)** ➔ **Showdown (Đọ bài)**.\n` +
                `• Kết hợp 2 lá trên tay và 5 lá trên bàn để tạo thành bộ 5 lá mạnh nhất!\n\n` +
                `🏆 **Thứ tự độ mạnh bài từ cao xuống thấp:**\n` +
                `1. Thùng Phá Sảnh ➔ 2. Tứ Quý ➔ 3. Cù Lũ ➔ 4. Thùng ➔ 5. Sảnh ➔ 6. Xám Cô ➔ 7. Hai Đôi ➔ 8. Một Đôi ➔ 9. Mậu Thần (Lá cao).\n\n` +
                `🎁 **Phần thưởng:** Thắng đoạt lấy Linh Thạch cược + Thưởng +30 Tu Vi!`
            )
            .setFooter({ text: 'Thiên Thu Hiền Giả Ban Luật' });

        return interaction.reply({ embeds: [rulesEmbed], flags: 64 });
    }

    const userId = interaction.user.id;
    const game = pokerGames.get(userId);

    if (!game) {
        return interaction.reply({ content: 'Trận Poker này đã kết thúc hoặc không tồn tại.', flags: 64 });
    }

    const targetUserId = customId.split(':')[1];
    if (targetUserId !== userId) {
        return interaction.reply({ content: 'Đây không phải ván Poker của đạo hữu!', flags: 64 });
    }

    if (customId.startsWith('pk_fold:')) {
        pokerGames.delete(userId);
        const profile = await UserProfile.getOrCreate(userId, interaction.user.username);
        profile.linhThach -= game.betAmount;
        profile.stats.pokerGames += 1;
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('🏳️ ĐẠO HỮU ĐÃ BỎ BÀI (FOLD)')
            .setDescription(
                `Đạo hữu **${interaction.user.username}** đã chịu thua, bỏ bài rút lui!\n\n` +
                `❌ Mất: **-${game.betAmount} Linh Thạch**\n` +
                `🧙‍♂️ Bài của Hiền Giả là: \` [ ${game.aiCards[0].toString()} ]  [ ${game.aiCards[1].toString()} ] \``
            )
            .setFooter({ text: 'Thắng bại là chuyện thường tình của đạo gia' });

        return interaction.update({ embeds: [embed], components: [] });
    }

    if (customId.startsWith('pk_next:')) {
        await interaction.deferUpdate();

        if (game.stage === 'preflop') {
            game.stage = 'flop';
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`pk_next:${userId}`)
                    .setLabel('🔮 Lật Lá Thứ 4 (Turn)')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('pk_rules')
                    .setLabel('📖 Luật Chơi')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`pk_fold:${userId}`)
                    .setLabel('🏳️ Bỏ Bài (Fold)')
                    .setStyle(ButtonStyle.Danger)
            );

            const flopStr = game.communityCards.slice(0, 3).map(c => c.toString()).join('  ');

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('🃏 HỒNG TRẦN POKER • VÒNG FLOP 🃏')
                .setDescription(
                    `🎴 Bài của đạo hữu: \` [ ${game.playerCards[0].toString()} ]  [ ${game.playerCards[1].toString()} ] \`\n\n` +
                    `🌐 **3 Lá Bài Flop đã lật:**\n` +
                    `>>> 🃏 **\` [ ${flopStr} ] \`**\n\n` +
                    `💎 Cược: **\`${game.betAmount}\` Linh Thạch**`
                );

            await interaction.editReply({ embeds: [embed], components: [row] });

        } else if (game.stage === 'flop') {
            game.stage = 'turn';
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`pk_next:${userId}`)
                    .setLabel('🌊 Lật Lá Thứ 5 (River)')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('pk_rules')
                    .setLabel('📖 Luật Chơi')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`pk_fold:${userId}`)
                    .setLabel('🏳️ Bỏ Bài (Fold)')
                    .setStyle(ButtonStyle.Danger)
            );

            const turnStr = game.communityCards.slice(0, 4).map(c => c.toString()).join('  ');

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('🃏 HỒNG TRẦN POKER • VÒNG TURN 🃏')
                .setDescription(
                    `🎴 Bài của đạo hữu: \` [ ${game.playerCards[0].toString()} ]  [ ${game.playerCards[1].toString()} ] \`\n\n` +
                    `🌐 **4 Lá Bài Chung đã lật:**\n` +
                    `>>> 🃏 **\` [ ${turnStr} ] \`**\n\n` +
                    `💎 Cược: **\`${game.betAmount}\` Linh Thạch**`
                );

            await interaction.editReply({ embeds: [embed], components: [row] });

        } else if (game.stage === 'turn') {
            game.stage = 'river';
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`pk_next:${userId}`)
                    .setLabel('⚔️ ĐỌ BÀI QUYẾT CHIẾN (SHOWDOWN)')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('pk_rules')
                    .setLabel('📖 Luật Chơi')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`pk_fold:${userId}`)
                    .setLabel('🏳️ Bỏ Bài (Fold)')
                    .setStyle(ButtonStyle.Danger)
            );

            const riverStr = game.communityCards.map(c => c.toString()).join('  ');

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('🃏 HỒNG TRẦN POKER • VÒNG RIVER 🃏')
                .setDescription(
                    `🎴 Bài của đạo hữu: \` [ ${game.playerCards[0].toString()} ]  [ ${game.playerCards[1].toString()} ] \`\n\n` +
                    `🌐 **Đủ 5 Lá Bài Chung:**\n` +
                    `>>> 🃏 **\` [ ${riverStr} ] \`**\n\n` +
                    `💎 Cược: **\`${game.betAmount}\` Linh Thạch**`
                );

            await interaction.editReply({ embeds: [embed], components: [row] });

        } else if (game.stage === 'river') {
            // Showdown!
            pokerGames.delete(userId);

            const playerEval = evaluate7Cards([...game.playerCards, ...game.communityCards]);
            const aiEval = evaluate7Cards([...game.aiCards, ...game.communityCards]);

            const profile = await UserProfile.getOrCreate(userId, interaction.user.username);
            profile.stats.pokerGames += 1;

            let isPlayerWin = false;
            let isDraw = false;
            let resultText = '';

            if (playerEval.score > aiEval.score) {
                isPlayerWin = true;
                profile.linhThach += game.betAmount;
                profile.stats.pokerWins += 1;
                profile.addTuVi(30);
                resultText = `🎉 **ĐẠO HỮU CHIẾN THẮNG:** +${game.betAmount} Linh Thạch & +30 Tu Vi!`;
            } else if (playerEval.score < aiEval.score) {
                profile.linhThach -= game.betAmount;
                resultText = `❌ **HIỀN GIẢ CHIẾN THẮNG:** -${game.betAmount} Linh Thạch!`;
            } else {
                isDraw = true;
                resultText = `🤝 **HÒA CỜ:** Linh Thạch hoàn trả!`;
            }

            await profile.save();

            const communityStr = game.communityCards.map(c => c.toString()).join('  ');
            const playerCardStr = game.playerCards.map(c => c.toString()).join('  ');
            const aiCardStr = game.aiCards.map(c => c.toString()).join('  ');

            const winnerName = isPlayerWin ? interaction.user.username : isDraw ? 'Hòa' : 'Thiên Thư Hiền Giả';
            const winningHand = isPlayerWin ? playerEval.rankName : aiEval.rankName;

            const aiCommentary = await generatePokerCommentary('Showdown', game.communityCards.map(c => c.toString()), winnerName, winningHand);

            const embed = new EmbedBuilder()
                .setColor(isPlayerWin ? '#2ECC71' : isDraw ? '#F1C40F' : '#E74C3C')
                .setTitle('⚔️ KẾT QUẢ ĐỌ BÀI POKER SHOWDOWN ⚔️')
                .setDescription(
                    `🌐 **5 Lá Bài Chung:**\n\` [ ${communityStr} ] \`\n\n` +
                    `👤 **Bài của ${interaction.user.username}:**\n` +
                    `\` [ ${playerCardStr} ] \` => **${playerEval.rankName}**\n\n` +
                    `🧙‍♂️ **Bài của Thiên Thư Hiền Giả:**\n` +
                    `\` [ ${aiCardStr} ] \` => **${aiEval.rankName}**\n\n` +
                    `🎯 **${resultText}**\n\n` +
                    `💬 **Lời Phê Của Hiền Giả:**\n*"${aiCommentary}"*\n\n` +
                    `💰 Số dư Linh Thạch: **\`${profile.linhThach.toLocaleString()}\`**`
                )
                .setFooter({ text: 'Hồng Trần Đổ Đạo • Thiên Thu Môn' });

            await interaction.editReply({ embeds: [embed], components: [] });
        }
    }
};

module.exports = {
    commands: [pokerCommand],
    interactions: {
        'pk_next': handlePokerButtons,
        'pk_rules': handlePokerButtons,
        'pk_fold': handlePokerButtons,
    }
};
