const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { validateWordVI, validateWordEN } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');

// In-memory active games by channelId
const activeGames = new Map();

const noituViCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-vi')
        .setDescription('🐲 Khai mở sòng Nối Từ Tiếng Việt tại kênh này')
        .addStringOption(option => 
            option.setName('tudau')
                .setDescription('Từ khởi đầu (Ví dụ: Tu tiên)')
                .setRequired(false)
        ),
    async execute(interaction) {
        const channelId = interaction.channelId;
        if (activeGames.has(channelId)) {
            return interaction.reply({
                content: '⚠️ Trong kênh này đang có sòng Nối Từ đang diễn ra rồi! Nhập từ để nối hoặc dùng `/noitu-stop` để hủy.',
                flags: 64
            });
        }

        const startWord = (interaction.options.getString('tudau') || 'Tu Tiên').trim();

        activeGames.set(channelId, {
            lang: 'vi',
            lastWord: startWord,
            lastUserId: interaction.user.id,
            usedWords: new Set([startWord.toLowerCase()]),
            scoreCount: 1
        });

        const embed = new EmbedBuilder()
            .setColor('#1ABC9C')
            .setTitle('🐲 KHAI MỞ GAME NỐI TỪ TIẾNG VIỆT 🐲')
            .setDescription(
                `Hiền Giả đã mở trận Luận Từ tại kênh này!\n\n` +
                `👉 Từ mở màn: **"${startWord}"**\n` +
                `👉 Người chơi tiếp theo hãy nhắn một từ ghép tiếng Việt bắt đầu bằng tiếng **"${startWord.split(/\s+/).pop()}"**!\n\n` +
                `*Mỗi từ nối thành công nhận +15 Linh Thạch & +10 Tu Vi.*`
            )
            .setFooter({ text: 'Gửi tin nhắn trực tiếp vào kênh để tham gia nối từ • /noitu-stop để dừng' });

        await interaction.reply({ embeds: [embed] });
    }
};

const noituEnCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-en')
        .setDescription('🐉 English Word Chain - Nối từ tiếng Anh')
        .addStringOption(option => 
            option.setName('tudau')
                .setDescription('Initial word (e.g., Dragon)')
                .setRequired(false)
        ),
    async execute(interaction) {
        const channelId = interaction.channelId;
        if (activeGames.has(channelId)) {
            return interaction.reply({
                content: '⚠️ Active word chain game running in this channel! Use `/noitu-stop` to stop.',
                flags: 64
            });
        }

        const startWord = (interaction.options.getString('tudau') || 'Dragon').trim();

        activeGames.set(channelId, {
            lang: 'en',
            lastWord: startWord,
            lastUserId: interaction.user.id,
            usedWords: new Set([startWord.toLowerCase()]),
            scoreCount: 1
        });

        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('🐉 ENGLISH WORD CHAIN INITIATED 🐉')
            .setDescription(
                `Thiên Thư Hiền Giả has initiated the English Word Chain!\n\n` +
                `👉 Initial word: **"${startWord}"**\n` +
                `👉 Next player must enter a valid English word starting with letter **"${startWord.slice(-1).toUpperCase()}"**!\n\n` +
                `*Success reward: +15 Linh Thạch & +10 Tu Vi.*`
            )
            .setFooter({ text: 'Type your word directly in channel • Use /noitu-stop to end' });

        await interaction.reply({ embeds: [embed] });
    }
};

const noituStopCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-stop')
        .setDescription('⛔ Kết thúc trận Nối Từ đang diễn ra trong kênh'),
    async execute(interaction) {
        const channelId = interaction.channelId;
        if (!activeGames.has(channelId)) {
            return interaction.reply({ content: 'Không có trận Nối Từ nào đang diễn ra ở kênh này.', flags: 64 });
        }

        const game = activeGames.get(channelId);
        activeGames.delete(channelId);

        await interaction.reply(`🛑 **Thiên Thư Hiền Giả** đã đóng sòng Nối Từ (${game.lang.toUpperCase()})! Đã hoàn thành ${game.scoreCount} từ nối.`);
    }
};

// Event listener for messageCreate
const onMessageCreate = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const game = activeGames.get(message.channelId);
        if (!game) return;

        const userText = message.content.trim();
        // Skip commands
        if (userText.startsWith('/')) return;

        const lowerText = userText.toLowerCase();

        // Check duplicated word
        if (game.usedWords.has(lowerText)) {
            await message.react('❌').catch(() => {});
            await message.reply(`⚠️ Từ **"${userText}"** đã được dùng trước đó rồi! Đạo hữu hãy chọn từ khác.`).catch(() => {});
            return;
        }

        if (game.lang === 'vi') {
            const lastPart = game.lastWord.trim().split(/\s+/).pop().toLowerCase();
            const firstPart = userText.split(/\s+/)[0].toLowerCase();

            if (lastPart !== firstPart) {
                await message.react('❌').catch(() => {});
                await message.reply(`⚠️ Không hợp lệ! Từ phải bắt đầu bằng tiếng **"${lastPart.toUpperCase()}"** (Từ trước: "${game.lastWord}").`).catch(() => {});
                return;
            }

            // Validate with AI
            const res = await validateWordVI(game.lastWord, userText);
            if (!res.valid) {
                await message.react('❌').catch(() => {});
                await message.reply(`❌ ${res.reason}`).catch(() => {});
                return;
            }

            // Valid word!
            game.lastWord = userText;
            game.usedWords.add(lowerText);
            game.lastUserId = message.author.id;
            game.scoreCount++;

            // Update user profile
            const profile = await UserProfile.getOrCreate(message.author.id, message.author.username);
            profile.linhThach += 15;
            profile.stats.noituWins += 1;
            profile.addTuVi(10);
            await profile.save();

            await message.react('✅').catch(() => {});
            
            const lastWordPart = userText.split(/\s+/).pop();
            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setDescription(
                    `✨ **Nối từ thành công:** "${userText}"\n` +
                    `💬 *Hiền Giả:* "${res.reason}"\n` +
                    `🎁 Thưởng: **+15 💎 Linh Thạch** | **+10 ✨ Tu Vi**\n` +
                    `👉 Từ tiếp theo phải bắt đầu bằng tiếng: **"${lastWordPart.toUpperCase()}"**`
                );

            await message.channel.send({ embeds: [embed] }).catch(() => {});

        } else if (game.lang === 'en') {
            const lastChar = game.lastWord.trim().slice(-1).toLowerCase();
            const firstChar = userText.slice(0, 1).toLowerCase();

            if (lastChar !== firstChar) {
                await message.react('❌').catch(() => {});
                await message.reply(`⚠️ Must start with letter **"${lastChar.toUpperCase()}"** (Last word: "${game.lastWord}").`).catch(() => {});
                return;
            }

            const res = await validateWordEN(game.lastWord, userText);
            if (!res.valid) {
                await message.react('❌').catch(() => {});
                await message.reply(`❌ ${res.reason}`).catch(() => {});
                return;
            }

            // Valid English word!
            game.lastWord = userText;
            game.usedWords.add(lowerText);
            game.lastUserId = message.author.id;
            game.scoreCount++;

            const profile = await UserProfile.getOrCreate(message.author.id, message.author.username);
            profile.linhThach += 15;
            profile.stats.noituWins += 1;
            profile.addTuVi(10);
            await profile.save();

            await message.react('✅').catch(() => {});

            const nextChar = userText.slice(-1).toUpperCase();
            const embed = new EmbedBuilder()
                .setColor('#3498DB')
                .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
                .setDescription(
                    `✨ **Word Accepted:** "${userText}" (${res.meaning})\n` +
                    `💬 *Hiền Giả:* "${res.reason}"\n` +
                    `🎁 Reward: **+15 💎 Linh Thạch** | **+10 ✨ Tu Vi**\n` +
                    `👉 Next word must start with letter: **"${nextChar}"**`
                );

            await message.channel.send({ embeds: [embed] }).catch(() => {});
        }
    }
};

module.exports = {
    commands: [noituViCommand, noituEnCommand, noituStopCommand],
    interactions: {},
    events: [onMessageCreate]
};
