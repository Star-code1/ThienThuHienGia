const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const { generateVuaTiengVietQuestion } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');

// Stores active Vua Tiếng Việt games: channelId -> gameObj
const activeVuaGames = new Map();

const vuatiengvietCommand = {
    data: new SlashCommandBuilder()
        .setName('vuatiengviet')
        .setDescription('👑 Khai mở thử thách Vua Tiếng Việt - Giải đoán ký tự xáo trộn')
        .addStringOption(option =>
            option.setName('dokho')
                .setDescription('Chọn độ khó')
                .setRequired(false)
                .addChoices(
                    { name: '🟢 Dễ', value: 'de' },
                    { name: '🟡 Trung bình', value: 'trung_binh' },
                    { name: '🔴 Khó (Chủ đề Tu Tiên)', value: 'kho' }
                )
        ),
    async execute(interaction) {
        const channelId = interaction.channelId;

        if (activeVuaGames.has(channelId)) {
            return interaction.reply({
                content: '⚠️ Trong kênh này đang có câu đố Vua Tiếng Việt chưa được giải đáp! Hãy trả lời hoặc bấm nút Đầu hàng.',
                flags: 64
            });
        }

        await interaction.deferReply();

        const dokho = interaction.options.getString('dokho') || 'trung_binh';
        const questionData = await generateVuaTiengVietQuestion(dokho);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vtv_hint:${channelId}`)
                .setLabel('💡 Gợi Ý Thơ Tiên Hiệp')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`vtv_giveup:${channelId}`)
                .setLabel('🏳️ Đầu Hàng')
                .setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle('👑 VUA TIẾNG VIỆT • THỬ THÁCH NGỘ TÍNH 👑')
            .setDescription(
                `**Thiên Thư Hiền Giả** đã đưa ra các ký tự bị tâm ma xáo trộn:\n\n` +
                `🔤 Ký tự xáo trộn: **\` ${questionData.scrambledLetters} \`**\n\n` +
                `👉 Đạo hữu hãy nhắn câu trả lời chính xác trực tiếp vào kênh này!\n` +
                `🎁 Thần thưởng: **+50 Linh Thạch** | **+25 Tu Vi**`
            )
            .setFooter({ text: 'Thời gian giải đáp: 3 phút' })
            .setTimestamp();

        const replyMsg = await interaction.editReply({ embeds: [embed], components: [row] });

        // Save game state
        activeVuaGames.set(channelId, {
            originalWord: questionData.originalWord,
            scrambledLetters: questionData.scrambledLetters,
            hint: questionData.hint,
            startTime: Date.now(),
            replyMsgId: replyMsg.id,
            authorId: interaction.user.id
        });
    }
};

// Event listener for messageCreate answering the puzzle
const onMessageCreate = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const game = activeVuaGames.get(message.channelId);
        if (!game) return;

        const cleanUserWord = message.content.trim().toUpperCase().replace(/\s+/g, ' ');
        const cleanAnswer = game.originalWord.trim().toUpperCase().replace(/\s+/g, ' ');

        if (cleanUserWord === cleanAnswer) {
            // Correct answer!
            activeVuaGames.delete(message.channelId);

            const profile = await UserProfile.getOrCreate(message.author.id, message.author.username);
            profile.linhThach += 50;
            profile.stats.vuatiengvietWins += 1;
            const newRealm = profile.addTuVi(25);
            await profile.save();

            await message.react('🎉').catch(() => {});

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('👑 CHÚC MỪNG VUA TIẾNG VIỆT! 👑')
                .setDescription(
                    `🎉 Đạo hữu **${message.author.username}** với ngộ tính phi thường đã giải đáp chính xác!\n\n` +
                    `✨ Đáp án đúng: **"${game.originalWord}"**\n` +
                    `🎁 Phần thưởng: **+50 💎 Linh Thạch** | **+25 ✨ Tu Vi**\n` +
                    `🔮 Cảnh giới hiện tại: **${newRealm}**`
                )
                .setFooter({ text: 'Thiên Thư Hiền Giả Tán Thưởng' });

            await message.channel.send({ embeds: [embed] });
        }
    }
};

// Interaction handler for buttons
const handleVuaButtons = async (interaction) => {
    const customId = interaction.customId;
    const channelId = interaction.channelId;
    const game = activeVuaGames.get(channelId);

    if (!game) {
        return interaction.reply({ content: 'Câu đố này đã kết thúc hoặc không còn tồn tại.', flags: 64 });
    }

    if (customId.startsWith('vtv_hint:')) {
        await interaction.reply({
            content: `💡 **Gợi Ý Thơ Tiên Hiệp từ Hiền Giả:**\n*"${game.hint}"*`,
            flags: 64
        });
    } else if (customId.startsWith('vtv_giveup:')) {
        activeVuaGames.delete(channelId);

        const embed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('🏳️ THỬ THÁCH KẾT THÚC')
            .setDescription(
                `Đạo hữu **${interaction.user.username}** đã tuyên bố đầu hàng trước tâm ma!\n\n` +
                `✨ Đáp án chính xác là: **"${game.originalWord}"**`
            )
            .setFooter({ text: 'Thiên Thư Môn • Tu luyện là con đường gian nan' });

        await interaction.update({ embeds: [embed], components: [] });
    }
};

module.exports = {
    commands: [vuatiengvietCommand],
    interactions: {
        'vtv_hint': handleVuaButtons,
        'vtv_giveup': handleVuaButtons,
    },
    events: [onMessageCreate]
};
