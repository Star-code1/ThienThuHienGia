const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { validateWordVI, validateWordEN, getRandomEnglishStartWord } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const {
    parseVietnameseWord, parseEnglishWord, splitSyllables, toKey, streakBonus,
} = require('../../shared/utils/wordGame');
const { claimChannel, releaseChannel, gameLabel } = require('../../shared/channelGames');

const GAME_TYPE = 'noitu';
const TURN_MS = 30_000;
const MAX_TIMEOUTS = 5;
const REWARD_LINH_THACH = 50;
const REWARD_TU_VI = 10;
const TIMEOUT_BONUS = 20;
const NO_MENTIONS = { parse: [], repliedUser: false };

// Các sòng đang chạy theo kênh: channelId -> game
const activeGames = new Map();

const FALLBACK_WORDS_VI = ['Tu Tiên', 'Nghịch Thủy', 'Huyết Hà', 'Tố Vấn', 'Linh Thạch', 'Kim Đan', 'Bang Chiến', 'Hiền Giả', 'Giang Hồ', 'Thiên Thư'];
const FALLBACK_WORDS_EN = ['Dragon', 'Immortal', 'Phoenix', 'Guild', 'Warrior', 'Mystic', 'Legend', 'Arcane', 'Crystal', 'Shadow'];

const lastSyllable = (word) => splitSyllables(word).pop();
const nextHintOf = (game) => (game.lang === 'vi' ? lastSyllable(game.lastWord).toUpperCase() : game.lastWord.slice(-1).toUpperCase());

/** Kết thúc sòng: dọn timer, bỏ khỏi sổ, nhả kênh. */
function endGame(channelId) {
    const game = activeGames.get(channelId);
    if (!game) return null;
    if (game.timer) clearTimeout(game.timer);
    game.timer = null;
    activeGames.delete(channelId);
    releaseChannel(channelId, GAME_TYPE);
    return game;
}

/** Chọn từ mới chưa dùng cho lượt mới / lúc mở sòng. */
async function pickFreshWord(game) {
    for (let i = 0; i < 3; i++) {
        const w = game.lang === 'vi'
            ? FALLBACK_WORDS_VI[Math.floor(Math.random() * FALLBACK_WORDS_VI.length)]
            : await getRandomEnglishStartWord();
        if (!game.usedWords.has(toKey(w))) return w;
    }
    const list = game.lang === 'vi' ? FALLBACK_WORDS_VI : FALLBACK_WORDS_EN;
    return list.find((w) => !game.usedWords.has(toKey(w))) || list[Math.floor(Math.random() * list.length)];
}

/**
 * Đặt lại đồng hồ 30s. Mỗi lần đặt = một "lượt" mới (turnId tăng) để phát hiện
 * các lượt thẩm định AI đã quá hạn.
 */
function resetTurnTimer(channelId, channel) {
    const game = activeGames.get(channelId);
    if (!game) return;

    if (game.timer) clearTimeout(game.timer);
    game.turnId += 1;

    game.timer = setTimeout(async () => {
        const current = activeGames.get(channelId);
        if (current !== game) return;

        game.consecutiveTimeouts++;
        game.streaks.clear();

        // Thưởng một lần cho người vừa nối từ thành công cuối cùng (chủ sòng chưa nối thì không có thưởng)
        const rewardee = game.lastPlayerId;
        game.lastPlayerId = null;
        if (rewardee) {
            try {
                const profile = await UserProfile.getOrCreate(rewardee);
                await profile.incLinhThach(TIMEOUT_BONUS);
            } catch (e) { /* bỏ qua lỗi DB, không chặn game */ }
        }

        if (activeGames.get(channelId) !== game) return;

        if (game.consecutiveTimeouts >= MAX_TIMEOUTS) {
            endGame(channelId);
            const stopEmbed = new EmbedBuilder()
                .setColor('#E74C3C')
                .setTitle('🛑 SÒNG NỐI TỪ ĐÃ KẾT THÚC')
                .setDescription(
                    `⏳ Đã trôi qua **${MAX_TIMEOUTS} lượt liên tiếp (${TURN_MS / 1000} giây/lượt)** không có đạo hữu nào nối từ!\n` +
                    `🧙‍♂️ **Thiên Thư Hiền Giả** đã thu hồi trận pháp. Dùng lệnh \`/noitu-vi\` hoặc \`/noitu-en\` để mở sòng mới!`
                )
                .setFooter({ text: 'Thiên Thư Môn • Đạo pháp tự nhiên' });
            await channel.send({ embeds: [stopEmbed] }).catch(() => {});
            return;
        }

        const newWord = await pickFreshWord(game);
        if (activeGames.get(channelId) !== game) return;

        game.lastWord = newWord;
        game.usedWords.add(toKey(newWord));

        const timeoutEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle(`⏳ HẾT ${TURN_MS / 1000} GIÂY! MỞ LƯỢT MỚI (${game.consecutiveTimeouts}/${MAX_TIMEOUTS})`)
            .setDescription(
                `⏱️ Quá ${TURN_MS / 1000}s không ai nối từ!\n` +
                (rewardee ? `🏆 Đạo hữu nối từ cuối nhận thưởng thêm **+${TIMEOUT_BONUS} 💎 Linh Thạch**!\n\n` : '\n') +
                `👉 **Thiên Thư Hiền Giả** khởi tạo từ mới: **"${newWord}"**\n` +
                `👉 Từ tiếp theo bắt đầu bằng: **"${nextHintOf(game)}"**!`
            )
            .setFooter({ text: `Nhắn từ trực tiếp vào kênh để nối • Đếm ngược ${TURN_MS / 1000} giây` });
        await channel.send({ embeds: [timeoutEmbed] }).catch(() => {});

        resetTurnTimer(channelId, channel);
    }, TURN_MS);
}

function newGame(lang, startWord) {
    return {
        lang,
        lastWord: startWord,
        lastPlayerId: null,        // người nối thành công gần nhất (null: chưa ai / vừa hết giờ)
        players: new Set(),        // những người đã nối ít nhất 1 từ trong sòng
        streaks: new Map(),        // userId -> số từ đúng liên tiếp (sai/trùng từ hoặc hết giờ thì về 0)
        usedWords: new Set([toKey(startWord)]),
        consecutiveTimeouts: 0,
        timer: null,
        turnId: 0,
        busy: false,               // đang thẩm định một từ → chặn các tin nhắn chen ngang
    };
}

/** Chặn nếu kênh đang có game chữ khác chạy. Trả về true nếu bị chặn (đã trả lời). */
async function rejectIfChannelBusy(interaction) {
    const owner = claimChannel(interaction.channelId, GAME_TYPE);
    if (!owner) return false;
    await interaction.reply({
        content: `⚠️ Kênh này đang chơi **${gameLabel(owner)}**. Hãy kết thúc game đó trước khi mở Nối Từ!`,
        flags: 64,
    });
    return true;
}

const noituViCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-vi')
        .setDescription('🐲 Khai mở sòng Nối Từ Tiếng Việt (Nghịch Thủy Hàn & Tu Tiên)')
        .addStringOption(option =>
            option.setName('tudau')
                .setDescription('Từ khởi đầu, từ ghép 2–4 tiếng (Để trống sẽ chọn ngẫu nhiên)')
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

        const inputWord = interaction.options.getString('tudau');
        let startWord;
        if (inputWord) {
            const parsed = parseVietnameseWord(inputWord);
            if (!parsed.ok) {
                return interaction.reply({
                    content: '⚠️ Từ khởi đầu phải là từ ghép tiếng Việt gồm 2–4 tiếng, chỉ có chữ cái (ví dụ: `Tu Tiên`).',
                    flags: 64
                });
            }
            startWord = parsed.text;
        } else {
            startWord = FALLBACK_WORDS_VI[Math.floor(Math.random() * FALLBACK_WORDS_VI.length)];
        }

        if (await rejectIfChannelBusy(interaction)) return;

        const game = newGame('vi', startWord);
        activeGames.set(channelId, game);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('noitu_rules:vi')
                .setLabel('📖 Luật Chơi Nối Từ')
                .setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setColor('#1ABC9C')
            .setTitle('🐲 KHAI MỞ GAME NỐI TỪ TIẾNG VIỆT 🐲')
            .setDescription(
                `🧙‍♂️ **Thiên Thư Hiền Giả** đã mở trận Luận Từ tại Thiên Thư Môn!\n\n` +
                `👉 Từ mở màn: **"${startWord}"**\n` +
                `👉 Người chơi tiếp theo hãy nhắn một từ ghép tiếng Việt bắt đầu bằng tiếng **"${nextHintOf(game)}"**!\n\n` +
                `⏱️ **Thời gian mỗi lượt:** ${TURN_MS / 1000} giây (quá giờ không ai nối sẽ tự đổi từ mới; ${MAX_TIMEOUTS} lần liên tiếp sẽ dừng game).\n` +
                `🎁 **Phần thưởng:** +${REWARD_LINH_THACH} Linh Thạch & +${REWARD_TU_VI} Tu Vi mỗi từ đúng.`
            )
            .setFooter({ text: 'Nhắn từ trực tiếp vào kênh để tham gia • /noitu-stop để dừng' });

        await interaction.reply({ embeds: [embed], components: [row] });
        resetTurnTimer(channelId, interaction.channel);
    }
};

const noituEnCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-en')
        .setDescription('🐉 English Word Chain - Nối từ tiếng Anh (Từ mở màn Random 100%)'),
    async execute(interaction) {
        const channelId = interaction.channelId;
        if (activeGames.has(channelId)) {
            return interaction.reply({
                content: '⚠️ Active word chain game running in this channel! Use `/noitu-stop` to stop.',
                flags: 64
            });
        }
        if (await rejectIfChannelBusy(interaction)) return;

        await interaction.deferReply();

        let startWord;
        try {
            startWord = await getRandomEnglishStartWord();
        } catch (e) {
            startWord = FALLBACK_WORDS_EN[Math.floor(Math.random() * FALLBACK_WORDS_EN.length)];
        }

        // Có thể có người mở sòng khác trong lúc chờ AI
        if (activeGames.has(channelId)) {
            return interaction.editReply('⚠️ Active word chain game running in this channel! Use `/noitu-stop` to stop.');
        }

        const game = newGame('en', startWord);
        activeGames.set(channelId, game);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('noitu_rules:en')
                .setLabel('📖 English Chain Rules')
                .setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('🐉 ENGLISH WORD CHAIN INITIATED 🐉')
            .setDescription(
                `🧙‍♂️ **Thiên Thư Hiền Giả** has initiated the English Word Chain!\n\n` +
                `👉 Random initial word: **"${startWord}"**\n` +
                `👉 Next player must enter ONE valid English word starting with the letter **"${nextHintOf(game)}"**!\n\n` +
                `⏱️ **Time limit:** ${TURN_MS / 1000} seconds per turn (${MAX_TIMEOUTS} consecutive timeouts = game over).\n` +
                `🎁 **Reward:** +${REWARD_LINH_THACH} Linh Thạch & +${REWARD_TU_VI} Tu Vi.`
            )
            .setFooter({ text: 'Type your word directly in channel • Use /noitu-stop to end' });

        await interaction.editReply({ embeds: [embed], components: [row] });
        resetTurnTimer(channelId, interaction.channel);
    }
};

const noituStopCommand = {
    data: new SlashCommandBuilder()
        .setName('noitu-stop')
        .setDescription('⛔ Kết thúc trận Nối Từ đang diễn ra trong kênh'),
    async execute(interaction) {
        const game = endGame(interaction.channelId);
        if (!game) {
            return interaction.reply({ content: 'Không có trận Nối Từ nào đang diễn ra ở kênh này.', flags: 64 });
        }
        await interaction.reply(`🛑 **Thiên Thư Hiền Giả** đã đóng sòng Nối Từ (${game.lang.toUpperCase()}) theo yêu cầu của đạo hữu!`);
    }
};

// Interaction handler cho nút bấm luật chơi
const handleNoituRules = async (interaction) => {
    const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle('📖 HƯỚNG DẪN & LUẬT CHƠI NỐI TỪ')
        .setDescription(
            `🐲 **NỐI TỪ TIẾNG VIỆT (\`/noitu-vi\`):**\n` +
            `• Nhắn trực tiếp một từ ghép **2–4 tiếng** có nghĩa vào kênh.\n` +
            `• Tiếng đầu của từ bạn nhắn phải TRÙNG (cả dấu thanh) với tiếng cuối của từ trước.\n` +
            `  *Ví dụ:* "Tu **Tiên**" ➔ "**Tiên** Giới" ➔ "**Giới** Hạn".\n\n` +
            `🐉 **ENGLISH WORD CHAIN (\`/noitu-en\`):**\n` +
            `• Nhắn MỘT từ tiếng Anh có thật (chỉ chữ cái).\n` +
            `• Chữ cái ĐẦU của từ bạn nhắn phải trùng với chữ cái CUỐI của từ trước.\n` +
            `  *Ví dụ:* "Drago**n**" ➔ "**N**irvana" ➔ "**A**rcane".\n\n` +
            `📏 **Luật chung:**\n` +
            `• Không dùng lại từ đã xuất hiện trong sòng.\n` +
            `• Một người được phép nối **nhiều lượt liên tiếp**.\n` +
            `• ⏱️ ${TURN_MS / 1000} giây/lượt. Quá giờ không ai nối sẽ đổi từ ngẫu nhiên (người nối cuối được +${TIMEOUT_BONUS} 💎). ${MAX_TIMEOUTS} lượt hết giờ liên tiếp sòng sẽ tự đóng.\n` +
            `• Tin nhắn trò chuyện thường (không giống một từ) sẽ được bỏ qua.\n\n` +
            `🔥 **Chuỗi thắng:** nối đúng liên tiếp (không sai/trùng từ, không hết giờ) được thưởng thêm +5 💎 mỗi bậc từ chuỗi 2, tối đa +30 💎. Kỷ lục chuỗi được ghi vào bảng xếp hạng \`/top-linhthach\`.\n` +
            `🎁 **Thưởng:** +${REWARD_LINH_THACH} Linh Thạch & +${REWARD_TU_VI} Tu Vi cho mỗi từ đúng!`
        )
        .setFooter({ text: 'Thiên Thư Hiền Giả Ban Luật' });

    await interaction.reply({ embeds: [embed], flags: 64 });
};

const reply = (message, content) => message.reply({ content, allowedMentions: NO_MENTIONS }).catch(() => {});

// Listener cho messageCreate
const onMessageCreate = {
    name: 'messageCreate',
    once: false,
    async execute(message) {
        if (message.author.bot || !message.guild) return;

        const game = activeGames.get(message.channelId);
        if (!game) return;

        const isVi = game.lang === 'vi';
        const parsed = isVi ? parseVietnameseWord(message.content) : parseEnglishWord(message.content);
        // Tin nhắn không giống một lượt nối từ → là trò chuyện thường, bỏ qua im lặng
        if (!parsed.ok) return;

        const word = parsed.text;
        const key = toKey(word);

        // Luật nối (so sánh có dấu, đã chuẩn hoá NFC). Sai luật → chỉ thả ❌, không spam kênh.
        const need = isVi ? toKey(lastSyllable(game.lastWord)) : game.lastWord.slice(-1).toLowerCase();
        const got = isVi ? toKey(parsed.syllables[0]) : key.slice(0, 1);
        if (need !== got) {
            await message.react('❌').catch(() => {});
            return;
        }

        if (game.usedWords.has(key)) {
            game.streaks.set(message.author.id, 0);
            await message.react('❌').catch(() => {});
            return reply(message, `⚠️ ${isVi ? 'Từ' : 'The word'} **"${word}"** ${isVi ? 'đã được dùng trước đó rồi! Đạo hữu hãy chọn từ khác.' : 'was already used! Pick another one.'}`);
        }

        // Đang thẩm định từ khác → chặn chen ngang (tránh 2 người cùng "nối thành công" một lượt)
        if (game.busy) {
            await message.react('⏳').catch(() => {});
            return;
        }
        game.busy = true;
        const turnAtStart = game.turnId;
        let res;
        try {
            res = isVi ? await validateWordVI(game.lastWord, word) : await validateWordEN(game.lastWord, word);
        } finally {
            game.busy = false;
        }

        // Trong lúc chờ AI sòng có thể đã đóng / hết giờ / đổi từ
        if (activeGames.get(message.channelId) !== game || game.turnId !== turnAtStart) {
            return reply(message, isVi
                ? '⌛ Lượt này đã hết giờ trong lúc Hiền Giả thẩm định, đạo hữu thử với từ mới nhé!'
                : '⌛ That turn timed out while I was checking. Try again with the new word!');
        }

        if (!res.valid) {
            if (!res.unavailable) game.streaks.set(message.author.id, 0); // lỗi hệ thống thì không phạt người chơi
            await message.react(res.unavailable ? '⚠️' : '❌').catch(() => {});
            return reply(message, `${res.unavailable ? '⚠️' : '❌'} ${res.reason}`);
        }

        // Nối từ thành công!
        game.lastWord = word;
        game.usedWords.add(key);
        game.lastPlayerId = message.author.id;
        game.players.add(message.author.id);
        game.consecutiveTimeouts = 0;
        resetTurnTimer(message.channelId, message.channel);

        const authorName = getDisplayName(message);
        const streak = (game.streaks.get(message.author.id) || 0) + 1;
        game.streaks.set(message.author.id, streak);
        const bonus = streakBonus(streak);
        const reward = REWARD_LINH_THACH + bonus;
        try {
            const profile = await UserProfile.getOrCreate(message.author.id, authorName);
            await profile.incLinhThach(reward, { inc: { 'stats.noituWins': 1 } });
            profile.addTuVi(REWARD_TU_VI);
            if (streak > (profile.stats?.noituBestStreak || 0)) profile.set('stats.noituBestStreak', streak);
            await profile.save();
        } catch (err) {
            console.error('❌ [NoiTu] Lỗi trả thưởng:', err.message);
        }

        await message.react('✅').catch(() => {});

        const embed = new EmbedBuilder()
            .setColor(isVi ? '#2ECC71' : '#3498DB')
            .setAuthor({ name: authorName, iconURL: message.author.displayAvatarURL() })
            .setDescription(
                (isVi
                    ? `✨ **Nối từ thành công:** "${word}"\n💬 *Hiền Giả:* "${res.reason}"\n` +
                      `🎁 Thưởng: **+${reward} 💎 Linh Thạch** | **+${REWARD_TU_VI} ✨ Tu Vi**\n` +
                      (streak >= 2 ? `🔥 **Chuỗi ${streak} từ liên tiếp**${bonus ? ` (+${bonus} 💎 thưởng chuỗi)` : ''}\n` : '') +
                      `👉 Từ tiếp theo phải bắt đầu bằng tiếng: **"${nextHintOf(game)}"**`
                    : `✨ **Word Accepted:** "${word}" (${res.meaning})\n💬 *Hiền Giả:* "${res.reason}"\n` +
                      `🎁 Reward: **+${reward} 💎 Linh Thạch** | **+${REWARD_TU_VI} ✨ Tu Vi**\n` +
                      (streak >= 2 ? `🔥 **Streak x${streak}**${bonus ? ` (+${bonus} 💎 streak bonus)` : ''}\n` : '') +
                      `👉 Next word must start with letter: **"${nextHintOf(game)}"**`)
            );

        await message.channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS }).catch(() => {});
    }
};

module.exports = {
    commands: [noituViCommand, noituEnCommand, noituStopCommand],
    interactions: {
        'noitu_rules': handleNoituRules
    },
    events: [onMessageCreate],
    onShutdown: () => { for (const id of [...activeGames.keys()]) endGame(id); },
    _internal: { activeGames, newGame, endGame },
};
