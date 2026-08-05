const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const { generateVuaTiengVietQuestion } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');

// Stores active Vua Tiếng Việt games per channel: channelId -> gameObject
const activeVuaGames = new Map();

/**
 * Đặt đếm ngược 1 phút (60 giây) cho Vua Tiếng Việt
 */
function startQuestionTimer(channelId, channel) {
    const game = activeVuaGames.get(channelId);
    if (!game) return;

    if (game.timer) clearTimeout(game.timer);

    game.timer = setTimeout(async () => {
        const currentGame = activeVuaGames.get(channelId);
        if (!currentGame) return;

        currentGame.consecutiveTimeouts++;

        if (currentGame.consecutiveTimeouts >= 5) {
            // Đã 5 lần liên tiếp không ai đoán -> Dừng trò chơi
            activeVuaGames.delete(channelId);
            const stopEmbed = new EmbedBuilder()
                .setColor('#E74C3C')
                .setTitle('🛑 KẾT THÚC VUA TIẾNG VIỆT')
                .setDescription(
                    `⏳ Đã trôi qua **5 câu đố liên tiếp (1 phút/câu)** không có đạo hữu nào giải đáp!\n` +
                    `✨ Đáp án của câu vừa rồi là: **"${currentGame.originalWord}"**\n\n` +
                    `🧙‍♂️ **Thiên Thu Hiền Giả** tuyên bố khép lại thử thách. Dùng lệnh \`/vuatiengviet\` để mở lại bất cứ lúc nào!`
                )
                .setFooter({ text: 'Thiên Thu Môn • Ngộ tính cần rèn luyện' });

            await channel.send({ embeds: [stopEmbed] }).catch(() => {});
            return;
        }

        // Thông báo hết giờ cho câu hiện tại & chuyển sang câu đố mới
        const timeoutEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle(`⏳ HẾT 1 PHÚT! ĐỔI CÂU ĐỐ MỚI (${currentGame.consecutiveTimeouts}/5)`)
            .setDescription(
                `⏱️ Hết 1 phút mà chưa có đạo hữu nào đoán đúng!\n` +
                `✨ Đáp án câu trước là: **"${currentGame.originalWord}"**\n\n` +
                `🔄 **Thiên Thu Hiền Giả** đang soạn câu đố mới...`
            );

        await channel.send({ embeds: [timeoutEmbed] }).catch(() => {});

        // Tạo câu đố tiếp theo
        const newQuestion = await generateVuaTiengVietQuestion(currentGame.difficulty);
        currentGame.originalWord = newQuestion.originalWord;
        currentGame.scrambledLetters = newQuestion.scrambledLetters;
        currentGame.hint = newQuestion.hint;

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

        const newEmbed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle('👑 VUA TIẾNG VIỆT • CÂU ĐỐ MỚI 👑')
            .setDescription(
                `🔤 Ký tự xáo trộn: **\` ${newQuestion.scrambledLetters} \`**\n\n` +
                `👉 Nhắn câu trả lời trực tiếp vào kênh này!\n` +
                `⏱️ **Đếm ngược:** 1 phút | 🎁 **Thưởng:** +50 Linh Thạch & +25 Tu Vi`
            )
            .setFooter({ text: 'Thời gian giải đáp: 1 phút' });

        await channel.send({ embeds: [newEmbed], components: [row] }).catch(() => {});

        // Đặt lại đếm ngược 1 phút cho câu đố mới
        startQuestionTimer(channelId, channel);
    }, 60000); // 1 phút = 60,000 ms
}

const vuatiengvietCommand = {
    data: new SlashCommandBuilder()
        .setName('vuatiengviet')
        .setDescription('👑 Khai mở thử thách Vua Tiếng Việt (Nghịch Thủy Hàn & Tu Tiên)')
        .addStringOption(option =>
            option.setName('dokho')
                .setDescription('Chọn độ khó')
                .setRequired(false)
                .addChoices(
                    { name: '🟢 Dễ', value: 'de' },
                    { name: '🟡 Trung bình', value: 'trung_binh' },
                    { name: '🔴 Khó (Chủ đề Nghịch Thủy Hàn / Tu Tiên)', value: 'kho' }
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
                `🧙‍♂️ **Thiên Thu Hiền Giả** đã đưa ra các ký tự bị xáo trộn:\n\n` +
                `🔤 Ký tự xáo trộn: **\` ${questionData.scrambledLetters} \`**\n\n` +
                `👉 Nhắn câu trả lời chính xác trực tiếp vào kênh này!\n` +
                `⏱️ **Đếm ngược:** 1 phút (Bỏ trống 5 câu liên tiếp sẽ kết thúc trò chơi).\n` +
                `🎁 **Thần thưởng:** +50 Linh Thạch | +25 Tu Vi`
            )
            .setFooter({ text: 'Thời gian giải đáp: 1 phút' })
            .setTimestamp();

        const replyMsg = await interaction.editReply({ embeds: [embed], components: [row] });

        const game = {
            difficulty: dokho,
            originalWord: questionData.originalWord,
            scrambledLetters: questionData.scrambledLetters,
            hint: questionData.hint,
            replyMsgId: replyMsg.id,
            authorId: interaction.user.id,
            consecutiveTimeouts: 0,
            timer: null
        };

        activeVuaGames.set(channelId, game);

        // Khởi động đếm ngược 1 phút
        startQuestionTimer(channelId, interaction.channel);
    }
};

// Event listener cho messageCreate
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
            // Đoán đúng!
            if (game.timer) clearTimeout(game.timer);

            const profile = await UserProfile.getOrCreate(message.author.id, message.author.username);
            profile.linhThach += 50;
            profile.stats.vuatiengvietWins += 1;
            const newRealm = profile.addTuVi(25);
            await profile.save();

            await message.react('🎉').catch(() => {});

            const winEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('👑 CHÚC MỪNG VUA TIẾNG VIỆT! 👑')
                .setDescription(
                    `🎉 Đạo hữu **${message.author.username}** với ngộ tính phi thường đã giải đáp chính xác!\n\n` +
                    `✨ Đáp án đúng: **"${game.originalWord}"**\n` +
                    `🎁 Phần thưởng: **+50 💎 Linh Thạch** | **+25 ✨ Tu Vi**\n` +
                    `🔮 Cảnh giới hiện tại: **${newRealm}**\n\n` +
                    `🔄 **Thiên Thu Hiền Giả** đang khởi tạo câu đố tiếp theo...`
                )
                .setFooter({ text: 'Thiên Thu Hiền Giả Tán Thưởng' });

            await message.channel.send({ embeds: [winEmbed] });

            // Tự động chuyển sang câu đố mới & reset timeout count
            game.consecutiveTimeouts = 0;
            const newQuestion = await generateVuaTiengVietQuestion(game.difficulty);
            game.originalWord = newQuestion.originalWord;
            game.scrambledLetters = newQuestion.scrambledLetters;
            game.hint = newQuestion.hint;

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`vtv_hint:${message.channelId}`)
                    .setLabel('💡 Gợi Ý Thơ Tiên Hiệp')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`vtv_giveup:${message.channelId}`)
                    .setLabel('🏳️ Đầu Hàng')
                    .setStyle(ButtonStyle.Danger)
            );

            const nextEmbed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('👑 VUA TIẾNG VIỆT • CÂU ĐỐ TIẾP THEO 👑')
                .setDescription(
                    `🔤 Ký tự xáo trộn: **\` ${newQuestion.scrambledLetters} \`**\n\n` +
                    `👉 Nhắn câu trả lời trực tiếp vào kênh này!\n` +
                    `⏱️ **Đếm ngược:** 1 phút | 🎁 **Thưởng:** +50 Linh Thạch & +25 Tu Vi`
                )
                .setFooter({ text: 'Thời gian giải đáp: 1 phút' });

            await message.channel.send({ embeds: [nextEmbed], components: [row] });

            // Đặt lại đếm ngược 1 phút
            startQuestionTimer(message.channelId, message.channel);
        }
    }
};

// Interaction handler cho các nút bấm
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
        if (game.timer) clearTimeout(game.timer);
        activeVuaGames.delete(channelId);

        const embed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('🏳️ THỬ THÁCH KẾT THÚC')
            .setDescription(
                `Đạo hữu **${interaction.user.username}** đã tuyên bố đầu hàng trước thử thách!\n\n` +
                `✨ Đáp án chính xác là: **"${game.originalWord}"**`
            )
            .setFooter({ text: 'Thiên Thu Môn • Tu luyện là con đường gian nan' });

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
