const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { validateWordVI, validateWordEN } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');

// Stores active games per channel: channelId -> gameObject
const activeGames = new Map();

const FALLBACK_WORDS_VI = ['Tu Tiên', 'Nghịch Thủy', 'Huyết Hà', 'Tố Vấn', 'Linh Thạch', 'Kim Đan', 'Bang Chiến', 'Hiền Giả', 'Giang Hồ', 'Thiên Thu'];
const FALLBACK_WORDS_EN = ['Dragon', 'Immortal', 'Phoenix', 'Guild', 'Warrior', 'Mystic', 'Legend', 'Arcane', 'Crystal', 'Shadow'];

/**
 * Đặt lại đồng hồ 30s cho Nối Từ
 */
function resetTurnTimer(channelId, channel) {
    const game = activeGames.get(channelId);
    if (!game) return;

    if (game.timer) clearTimeout(game.timer);

    game.timer = setTimeout(async () => {
        const currentGame = activeGames.get(channelId);
        if (!currentGame) return;

        currentGame.consecutiveTimeouts++;

        // Thưởng linh thạch cho người vừa nối từ thành công cuối cùng
        if (currentGame.lastUserId) {
            try {
                const profile = await UserProfile.getOrCreate(currentGame.lastUserId);
                profile.linhThach += 20;
                await profile.save();
            } catch (e) {}
        }

        if (currentGame.consecutiveTimeouts >= 5) {
            // Đã 5 lần không ai nối -> Dừng game
            activeGames.delete(channelId);
            const stopEmbed = new EmbedBuilder()
                .setColor('#E74C3C')
                .setTitle('🛑 SÒNG NỐI TỪ ĐÃ KẾT THÚC')
                .setDescription(
                    `⏳ Đã trôi qua **5 lượt liên tiếp (30 giây/lượt)** không có đạo hữu nào tham gia nối từ!\n` +
                    `🧙‍♂️ **Thiên Thu Hiền Giả** đã thu hồi trận pháp. Dùng lệnh \`/noitu-vi\` hoặc \`/noitu-en\` để mở sòng mới!`
                )
                .setFooter({ text: 'Thiên Thu Môn • Đạo pháp tự nhiên' });

            await channel.send({ embeds: [stopEmbed] }).catch(() => {});
            return;
        }

        // Chọn từ mới ngẫu nhiên để tiếp tục lượt mới
        let newWord = '';
        if (currentGame.lang === 'vi') {
            newWord = FALLBACK_WORDS_VI[Math.floor(Math.random() * FALLBACK_WORDS_VI.length)];
        } else {
            newWord = FALLBACK_WORDS_EN[Math.floor(Math.random() * FALLBACK_WORDS_EN.length)];
        }

        currentGame.lastWord = newWord;
        currentGame.usedWords.add(newWord.toLowerCase());
        const nextCharOrPart = currentGame.lang === 'vi' 
            ? newWord.split(/\s+/).pop().toUpperCase() 
            : newWord.slice(-1).toUpperCase();

        const timeoutEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle(`⏳ HẾT 30 GIÂY! MỞ LƯỢT MỚI (${currentGame.consecutiveTimeouts}/5)`)
            .setDescription(
                `⏱️ Quá 30s không ai nối từ!\n` +
                (currentGame.lastUserId ? `🏆 Đạo hữu nối từ cuối nhận thưởng thêm **+20 💎 Linh Thạch**!\n\n` : '\n') +
                `👉 **Thiên Thu Hiền Giả** khởi tạo từ mới: **"${newWord}"**\n` +
                `👉 Từ tiếp theo bắt đầu bằng: **"${nextCharOrPart}"**!`
            )
            .setFooter({ text: 'Nhắn từ trực tiếp vào kênh để nối • Đếm ngược 30 giây' });

        await channel.send({ embeds: [timeoutEmbed] }).catch(() => {});

        // Đặt lại đếm ngược 30s cho lượt mới
        resetTurnTimer(channelId, channel);
    }, 30000);
}

const noituViCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-vi')
        .setDescription('🐲 Khai mở sòng Nối Từ Tiếng Việt (Nghịch Thủy Hàn & Tu Tiên)')
        .addStringOption(option => 
            option.setName('tudau')
                .setDescription('Từ khởi đầu (Ví dụ: Nghịch Thủy)')
                .setRequired(false)
        ),
    async execute(interaction) {
        const channelId = interaction.channelId;
        if (activeGames.has(channelId)) {
            return interaction.reply({
                content: '⚠️ Trong kênh này đang có sòng Nối Từ diễn ra rồi! Nhập từ để nối hoặc dùng `/noitu-stop` để dừng.',
                flags: 64
            });
        }

        const startWord = (interaction.options.getString('tudau') || 'Nghịch Thủy').trim();

        const game = {
            lang: 'vi',
            lastWord: startWord,
            lastUserId: interaction.user.id,
            usedWords: new Set([startWord.toLowerCase()]),
            consecutiveTimeouts: 0,
            timer: null
        };

        activeGames.set(channelId, game);

        const embed = new EmbedBuilder()
            .setColor('#1ABC9C')
            .setTitle('🐲 KHAI MỞ GAME NỐI TỪ TIẾNG VIỆT 🐲')
            .setDescription(
                `🧙‍♂️ **Thiên Thu Hiền Giả** đã mở trận Luận Từ tại Thiên Thu Môn!\n\n` +
                `👉 Từ mở màn: **"${startWord}"**\n` +
                `👉 Người chơi tiếp theo hãy nhắn một từ ghép tiếng Việt bắt đầu bằng tiếng **"${startWord.split(/\s+/).pop()}"**!\n\n` +
                `⏱️ **Thời gian mỗi lượt:** 30 giây (Quá 30s không ai nối sẽ tự động đổi từ mới; 5 lần liên tiếp sẽ dừng game).\n` +
                `🎁 **Phần thưởng:** +15 Linh Thạch & +10 Tu Vi mỗi từ đúng.`
            )
            .setFooter({ text: 'Nhắn từ trực tiếp vào kênh để tham gia • /noitu-stop để dừng' });

        await interaction.reply({ embeds: [embed] });

        // Khởi động đồng hồ 30s
        resetTurnTimer(channelId, interaction.channel);
    }
};

const noituEnCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-en')
        .setDescription('🐉 English Word Chain - Nối từ tiếng Anh (Chấp nhận mọi từ hợp lệ)')
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

        const game = {
            lang: 'en',
            lastWord: startWord,
            lastUserId: interaction.user.id,
            usedWords: new Set([startWord.toLowerCase()]),
            consecutiveTimeouts: 0,
            timer: null
        };

        activeGames.set(channelId, game);

        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('🐉 ENGLISH WORD CHAIN INITIATED 🐉')
            .setDescription(
                `🧙‍♂️ **Thiên Thu Hiền Giả** has initiated the English Word Chain!\n\n` +
                `👉 Initial word: **"${startWord}"**\n` +
                `👉 Next player must enter ANY valid English word starting with letter **"${startWord.slice(-1).toUpperCase()}"**!\n\n` +
                `⏱️ **Time limit:** 30 seconds per turn (5 consecutive timeouts = game over).\n` +
                `🎁 **Reward:** +15 Linh Thạch & +10 Tu Vi.`
            )
            .setFooter({ text: 'Type your word directly in channel • Use /noitu-stop to end' });

        await interaction.reply({ embeds: [embed] });

        // Khởi động đồng hồ 30s
        resetTurnTimer(channelId, interaction.channel);
    }
};

const noituStopCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-stop')
        .setDescription('⛔ Kết thúc trận Nối Từ đang diễn ra trong kênh'),
    async execute(interaction) {
        const channelId = interaction.channelId;
        const game = activeGames.get(channelId);
        if (!game) {
            return interaction.reply({ content: 'Không có trận Nối Từ nào đang diễn ra ở kênh này.', flags: 64 });
        }

        if (game.timer) clearTimeout(game.timer);
        activeGames.delete(channelId);

        await interaction.reply(`🛑 **Thiên Thu Hiền Giả** đã đóng sòng Nối Từ (${game.lang.toUpperCase()}) theo yêu cầu của đạo hữu!`);
    }
};

// Listener cho messageCreate
const onMessageCreate = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const game = activeGames.get(message.channelId);
        if (!game) return;

        const userText = message.content.trim();
        if (userText.startsWith('/')) return;

        const lowerText = userText.toLowerCase();

        // Kiểm tra từ bị trùng
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

            // Thẩm định AI
            const res = await validateWordVI(game.lastWord, userText);
            if (!res.valid) {
                await message.react('❌').catch(() => {});
                await message.reply(`❌ ${res.reason}`).catch(() => {});
                return;
            }

            // Nối từ thành công!
            game.lastWord = userText;
            game.usedWords.add(lowerText);
            game.lastUserId = message.author.id;
            game.consecutiveTimeouts = 0; // Reset số lần timeout liên tiếp

            // Đặt lại timer 30s
            resetTurnTimer(message.channelId, message.channel);

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
            game.consecutiveTimeouts = 0; // Reset timeout counter

            // Đặt lại timer 30s
            resetTurnTimer(message.channelId, message.channel);

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
