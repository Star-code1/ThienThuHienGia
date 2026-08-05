const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const { generateBaucuaCommentary } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');

const LINH_THU = [
    { id: 'bau', name: 'Bầu (Lô Tháp)', emoji: '🍈' },
    { id: 'cua', name: 'Cua (Kim Quy)', emoji: '🦀' },
    { id: 'tom', name: 'Tôm (Linh Tôm)', emoji: '🦞' },
    { id: 'ca',  name: 'Cá (Thủy Tộc)', emoji: '🐟' },
    { id: 'ga',  name: 'Gà (Hoàng Yến)', emoji: '🐓' },
    { id: 'nai', name: 'Nai (Lộc Thần)', emoji: '🦌' },
];

// Active sessions for Bầu Cua: userId -> betData { selectedBeast, betAmount }
const userBets = new Map();

const baucuaCommand = {
    data: new SlashCommandBuilder()
        .setName('baucua')
        .setDescription('🎲 Gieo quẻ Bầu Cua Lục Đại Linh Thú nhận Linh Thạch')
        .addIntegerOption(option => 
            option.setName('cuoc')
                .setDescription('Số Linh Thạch muốn đặt cược (Mặc định: 100)')
                .setRequired(false)
                .setMinValue(10)
                .setMaxValue(10000)
        ),
    async execute(interaction) {
        const betAmount = interaction.options.getInteger('cuoc') || 100;
        const profile = await UserProfile.getOrCreate(interaction.user.id, interaction.user.username);

        if (profile.linhThach < betAmount) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach}\` 💎, số cược: \`${betAmount}\` 💎.`,
                flags: 64
            });
        }

        // Initialize user bet session
        userBets.set(interaction.user.id, {
            betAmount,
            selectedBeast: null
        });

        // Row 1: First 3 beasts
        const row1 = new ActionRowBuilder().addComponents(
            LINH_THU.slice(0, 3).map(beast => 
                new ButtonBuilder()
                    .setCustomId(`bc_select:${beast.id}`)
                    .setLabel(`${beast.emoji} ${beast.name.split(' ')[0]}`)
                    .setStyle(ButtonStyle.Secondary)
            )
        );

        // Row 2: Next 3 beasts
        const row2 = new ActionRowBuilder().addComponents(
            LINH_THU.slice(3, 6).map(beast => 
                new ButtonBuilder()
                    .setCustomId(`bc_select:${beast.id}`)
                    .setLabel(`${beast.emoji} ${beast.name.split(' ')[0]}`)
                    .setStyle(ButtonStyle.Secondary)
            )
        );

        // Row 3: Roll dice button
        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`bc_roll:${interaction.user.id}`)
                .setLabel('🎲 LẮC QUẺ GIEO XĂM')
                .setStyle(ButtonStyle.Success)
        );

        const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🎲 BẦU CUA LỤC ĐẠI LINH THÚ 🎲')
            .setDescription(
                `Chào mừng đạo hữu **${interaction.user.username}** đến với quẻ gieo Linh Thú!\n\n` +
                `💎 Mức cược hiện tại: **\`${betAmount.toLocaleString()}\` Linh Thạch**\n\n` +
                `👉 Hãy chọn **1 Linh Thú** bên dưới để linh khí nhập quẻ, sau đó bấm **[🎲 LẮC QUẺ GIEO XĂM]**!`
            )
            .setFooter({ text: 'Thiên Thư Hiền Giả Chưởng Quẻ' });

        await interaction.reply({ embeds: [embed], components: [row1, row2, row3] });
    }
};

const handleBaucuaInteractions = async (interaction) => {
    const customId = interaction.customId;
    const userId = interaction.user.id;

    if (customId.startsWith('bc_select:')) {
        const beastId = customId.split(':')[1];
        const beast = LINH_THU.find(b => b.id === beastId);
        
        let session = userBets.get(userId);
        if (!session) {
            session = { betAmount: 100, selectedBeast: beastId };
            userBets.set(userId, session);
        } else {
            session.selectedBeast = beastId;
        }

        return interaction.reply({
            content: `🎯 Đạo hữu đã chọn linh ứng vào: **${beast.emoji} ${beast.name}** với số cược \`${session.betAmount}\` Linh Thạch. Bấm nút Lắc Quẻ để gieo!`,
            flags: 64
        });
    }

    if (customId.startsWith('bc_roll:')) {
        const targetUserId = customId.split(':')[1];
        if (targetUserId !== userId) {
            return interaction.reply({ content: 'Đây không phải quẻ lắc của đạo hữu!', flags: 64 });
        }

        const session = userBets.get(userId);
        if (!session || !session.selectedBeast) {
            return interaction.reply({ content: '⚠️ Đạo hữu chưa chọn Linh Thú nào để đặt cược!', flags: 64 });
        }

        await interaction.deferUpdate();

        const profile = await UserProfile.getOrCreate(userId, interaction.user.username);
        const betAmount = session.betAmount;

        if (profile.linhThach < betAmount) {
            return interaction.followUp({ content: '⚠️ Đạo hữu không đủ Linh Thạch để lắc quẻ!', flags: 64 });
        }

        // Roll 3 dice
        const resultDice = [
            LINH_THU[Math.floor(Math.random() * 6)],
            LINH_THU[Math.floor(Math.random() * 6)],
            LINH_THU[Math.floor(Math.random() * 6)],
        ];

        const chosenBeast = LINH_THU.find(b => b.id === session.selectedBeast);
        const matchCount = resultDice.filter(b => b.id === session.selectedBeast).length;

        let profit = 0;
        if (matchCount > 0) {
            profit = betAmount * matchCount; // Win betAmount * matchCount
            profile.linhThach += profit;
        } else {
            profit = -betAmount;
            profile.linhThach -= betAmount;
        }

        profile.stats.baucuaGames += 1;
        profile.stats.baucuaWinLinhThach += profit;
        await profile.save();

        userBets.delete(userId);

        // Get AI commentary
        const diceNames = resultDice.map(d => `${d.emoji} ${d.name.split(' ')[0]}`);
        const aiCommentary = await generateBaucuaCommentary(diceNames, betAmount, profit);

        const isWin = matchCount > 0;
        const resultEmbed = new EmbedBuilder()
            .setColor(isWin ? '#2ECC71' : '#E74C3C')
            .setTitle(`🎲 KẾT QUẢ GIEO QUẺ BẦU CUA`)
            .setDescription(
                `🔮 3 Đại Linh Thú giáng thế:\n` +
                `>>> **${resultDice[0].emoji} ${resultDice[0].name}** | **${resultDice[1].emoji} ${resultDice[1].name}** | **${resultDice[2].emoji} ${resultDice[2].name}**\n\n` +
                `🎯 Đạo hữu đặt cược: **${chosenBeast.emoji} ${chosenBeast.name}** (\`${betAmount}\` 💎)\n` +
                `✨ Số lần xuất hiện: **${matchCount} lần**\n` +
                `${isWin ? `🎉 **THẮNG:** +${profit} Linh Thạch` : `❌ **THUA:** -${betAmount} Linh Thạch`}\n\n` +
                `💬 **Lời Quẻ Hiền Giả:**\n*"${aiCommentary}"*\n\n` +
                `💰 Số dư hiện tại: **\`${profile.linhThach.toLocaleString()}\` Linh Thạch**`
            )
            .setFooter({ text: 'Thiên Thư Hiền Giả Ban Quẻ' });

        await interaction.editReply({ embeds: [resultEmbed], components: [] });
    }
};

module.exports = {
    commands: [baucuaCommand],
    interactions: {
        'bc_select': handleBaucuaInteractions,
        'bc_roll': handleBaucuaInteractions,
    }
};
