const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');
const { generateVuaTiengVietQuestion } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const { matchesAnswer, streakBonus } = require('../../shared/utils/wordGame');
const { claimChannel, releaseChannel, gameLabel } = require('../../shared/channelGames');

const GAME_TYPE = 'vuatiengviet';
const QUESTION_MS = 60_000;
const MAX_TIMEOUTS = 5;
const REWARD = { linhThach: 50, tuVi: 25 };
const REWARD_AFTER_HINT = { linhThach: 35, tuVi: 15 };
const FAST_SECONDS = 15;
const FAST_BONUS = 15;
const NO_MENTIONS = { parse: [] };

// Các câu đố đang chạy theo kênh: channelId -> game
const activeVuaGames = new Map();

function endGame(channelId) {
    const game = activeVuaGames.get(channelId);
    if (!game) return null;
    if (game.timer) clearTimeout(game.timer);
    game.timer = null;
    activeVuaGames.delete(channelId);
    releaseChannel(channelId, GAME_TYPE);
    return game;
}

function controlRow(channelId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vtv_hint:${channelId}`).setLabel('💡 Gợi Ý (giảm thưởng)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vtv_rules:${channelId}`).setLabel('📖 Luật Chơi').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`vtv_giveup:${channelId}`).setLabel('🏳️ Đầu Hàng').setStyle(ButtonStyle.Danger)
    );
}

function questionEmbed(game, title, intro = '') {
    return new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle(title)
        .setDescription(
            (intro ? `${intro}\n\n` : '') +
            `🔤 Chữ cái xáo trộn: **\` ${game.scrambledLetters} \`**\n` +
            `📏 Đáp án gồm **${game.structure}**\n\n` +
            `👉 Nhắn đáp án (có dấu hoặc không dấu) trực tiếp vào kênh này!\n` +
            `⏱️ **Đếm ngược:** ${QUESTION_MS / 1000} giây • 🎁 **Thưởng:** +${REWARD.linhThach} Linh Thạch & +${REWARD.tuVi} Tu Vi ` +
            `(+${FAST_BONUS} 💎 nếu đoán trong ${FAST_SECONDS}s)`
        )
        .setFooter({ text: `Bỏ trống ${MAX_TIMEOUTS} câu liên tiếp trò chơi sẽ kết thúc` });
}

/** Nạp câu đố mới vào game (không bao giờ ném lỗi: AI hỏng thì dùng ngân hàng từ dự phòng). */
async function loadNextQuestion(game) {
    const q = await generateVuaTiengVietQuestion(game.difficulty, game.usedWords);
    game.originalWord = q.originalWord;
    game.scrambledLetters = q.scrambledLetters;
    game.structure = q.structure;
    game.hint = q.hint;
    game.hintUsed = false;
    game.usedWords.push(q.originalWord);
    game.askedAt = Date.now();
}

/** Đăng câu đố hiện tại của game và bật đồng hồ. */
async function postQuestion(channelId, channel, game, title, intro) {
    await channel.send({ embeds: [questionEmbed(game, title, intro)], components: [controlRow(channelId)] }).catch(() => {});
    game.solving = false;
    startQuestionTimer(channelId, channel);
}

/** Chuyển sang câu mới; lỗi bất ngờ thì đóng game, không để game "treo". */
async function advanceQuestion(channelId, channel, game, title) {
    try {
        await loadNextQuestion(game);
    } catch (err) {
        console.error('❌ [VuaTiengViet] Không tạo được câu đố:', err.message);
        if (activeVuaGames.get(channelId) === game) endGame(channelId);
        await channel.send('⚠️ **Thiên Thư Hiền Giả:** "Bổn Hiền Giả đang bận nhập định, xin hãy mở lại `/vuatiengviet` sau ít phút!"').catch(() => {});
        return;
    }
    if (activeVuaGames.get(channelId) !== game) return;
    await postQuestion(channelId, channel, game, title);
}

function startQuestionTimer(channelId, channel) {
    const game = activeVuaGames.get(channelId);
    if (!game) return;
    if (game.timer) clearTimeout(game.timer);

    game.timer = setTimeout(async () => {
        if (activeVuaGames.get(channelId) !== game || game.solving) return;
        game.solving = true; // chặn đáp án lọt vào giữa lúc chuyển câu

        game.consecutiveTimeouts++;
        game.streak = 0; // không ai đoán được → đứt chuỗi
        game.streakUserId = null;

        if (game.consecutiveTimeouts >= MAX_TIMEOUTS) {
            endGame(channelId);
            const stopEmbed = new EmbedBuilder()
                .setColor('#E74C3C')
                .setTitle('🛑 KẾT THÚC VUA TIẾNG VIỆT')
                .setDescription(
                    `⏳ Đã trôi qua **${MAX_TIMEOUTS} câu đố liên tiếp (${QUESTION_MS / 1000} giây/câu)** không có đạo hữu nào giải đáp!\n` +
                    `✨ Đáp án của câu vừa rồi là: **"${game.originalWord}"**\n\n` +
                    `🧙‍♂️ **Thiên Thư Hiền Giả** tuyên bố khép lại thử thách. Dùng lệnh \`/vuatiengviet\` để mở lại bất cứ lúc nào!`
                )
                .setFooter({ text: 'Thiên Thư Môn • Ngộ tính cần rèn luyện' });
            await channel.send({ embeds: [stopEmbed] }).catch(() => {});
            return;
        }

        const timeoutEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle(`⏳ HẾT GIỜ! ĐỔI CÂU ĐỐ MỚI (${game.consecutiveTimeouts}/${MAX_TIMEOUTS})`)
            .setDescription(
                `⏱️ Hết ${QUESTION_MS / 1000} giây mà chưa có đạo hữu nào đoán đúng!\n` +
                `✨ Đáp án câu trước là: **"${game.originalWord}"**\n\n` +
                `🔄 **Thiên Thư Hiền Giả** đang soạn câu đố mới...`
            );
        await channel.send({ embeds: [timeoutEmbed] }).catch(() => {});

        await advanceQuestion(channelId, channel, game, '👑 VUA TIẾNG VIỆT • CÂU ĐỐ MỚI 👑');
    }, QUESTION_MS);
}

const vuatiengvietCommand = {
    data: new SlashCommandBuilder()
        .setName('vuatiengviet')
        .setDescription('👑 Khai mở thử thách Vua Tiếng Việt')
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
        const owner = claimChannel(channelId, GAME_TYPE);
        if (owner) {
            return interaction.reply({
                content: `⚠️ Kênh này đang chơi **${gameLabel(owner)}**. Hãy kết thúc game đó trước khi mở Vua Tiếng Việt!`,
                flags: 64
            });
        }

        await interaction.deferReply();

        const game = {
            difficulty: interaction.options.getString('dokho') || 'trung_binh',
            originalWord: '',
            scrambledLetters: '',
            structure: '',
            hint: '',
            hintUsed: false,
            streak: 0,           // chuỗi thắng hiện tại của người đang dẫn
            streakUserId: null,
            usedWords: [],
            authorId: interaction.user.id,
            consecutiveTimeouts: 0,
            timer: null,
            solving: true, // chưa có câu đố → chưa nhận đáp án
            askedAt: Date.now(),
        };
        activeVuaGames.set(channelId, game);

        try {
            await loadNextQuestion(game);
        } catch (err) {
            endGame(channelId);
            return interaction.editReply('⚠️ **Thiên Thư Hiền Giả:** "Bổn Hiền Giả đang bận nhập định, xin hãy thử lại sau ít phút!"');
        }

        const intro = `🧙‍♂️ **Thiên Thư Hiền Giả** đã vận dụng trí tuệ uyên bác tạo ra câu đố xáo trộn chữ cái:`;
        await interaction.editReply({
            embeds: [questionEmbed(game, '👑 VUA TIẾNG VIỆT • THỬ THÁCH NGỘ TÍNH 👑', intro)],
            components: [controlRow(channelId)],
        });
        game.solving = false;
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
        if (!game || game.solving) return;
        if (!matchesAnswer(message.content, game.originalWord)) return;

        // Khoá ngay (trước mọi await) để hai người đúng cùng lúc không cùng nhận thưởng
        game.solving = true;
        if (game.timer) clearTimeout(game.timer);

        const elapsed = (Date.now() - game.askedAt) / 1000;
        const base = game.hintUsed ? REWARD_AFTER_HINT : REWARD;
        const bonus = !game.hintUsed && elapsed <= FAST_SECONDS ? FAST_BONUS : 0;
        // Chuỗi thắng: cùng một người đoán đúng liên tiếp nhiều câu (người khác thắng xen vào thì đứt)
        game.streak = game.streakUserId === message.author.id ? (game.streak || 0) + 1 : 1;
        game.streakUserId = message.author.id;
        const streakExtra = streakBonus(game.streak);
        const linhThach = base.linhThach + bonus + streakExtra;
        const answer = game.originalWord;

        const authorName = getDisplayName(message);
        let newRealm = '—';
        try {
            const profile = await UserProfile.getOrCreate(message.author.id, authorName);
            await profile.incLinhThach(linhThach, { inc: { 'stats.vuatiengvietWins': 1 } });
            newRealm = profile.addTuVi(base.tuVi);
            if (game.streak > (profile.stats?.vuatiengvietBestStreak || 0)) profile.set('stats.vuatiengvietBestStreak', game.streak);
            await profile.save();
        } catch (err) {
            console.error('❌ [VuaTiengViet] Lỗi trả thưởng:', err.message);
        }

        await message.react('🎉').catch(() => {});

        const winEmbed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('👑 CHÚC MỪNG VUA TIẾNG VIỆT! 👑')
            .setDescription(
                `🎉 Đạo hữu **${authorName}** với ngộ tính phi thường đã giải đáp chính xác!\n\n` +
                `✨ Đáp án đúng: **"${answer}"**\n` +
                `🎁 Phần thưởng: **+${linhThach} 💎 Linh Thạch** | **+${base.tuVi} ✨ Tu Vi**` +
                (bonus ? ` *(thưởng nhanh +${bonus})*` : '') +
                (game.hintUsed ? ' *(đã dùng gợi ý)*' : '') + '\n' +
                (game.streak >= 2 ? `🔥 **Chuỗi thắng x${game.streak}**${streakExtra ? ` (+${streakExtra} 💎 thưởng chuỗi)` : ''} — giữ vững phong độ!\n` : '') +
                `🔮 Cảnh giới hiện tại: **${newRealm}**\n\n` +
                `🔄 **Thiên Thư Hiền Giả** đang luận giải câu đố tiếp theo...`
            )
            .setFooter({ text: 'Thiên Thư Hiền Giả Tán Thưởng' });
        await message.channel.send({ embeds: [winEmbed], allowedMentions: NO_MENTIONS }).catch(() => {});

        if (activeVuaGames.get(message.channelId) !== game) return; // bị đóng trong lúc chờ
        game.consecutiveTimeouts = 0;
        await advanceQuestion(message.channelId, message.channel, game, '👑 VUA TIẾNG VIỆT • CÂU ĐỐ TIẾP THEO 👑');
    }
};

const RULES_EMBED = () => new EmbedBuilder()
    .setColor('#F1C40F')
    .setTitle('📖 LUẬT CHƠI VUA TIẾNG VIỆT')
    .setDescription(
        `👑 **Thể loại:** Xếp lại các chữ cái xáo trộn thành từ ghép tiếng Việt đúng (có gợi ý số tiếng và số chữ cái).\n\n` +
        `🧙‍♂️ **Nội dung:** Hiền Giả chọn từ ngẫu nhiên theo độ khó (đời sống, thiên nhiên, cảm xúc, Hán Việt, tiên hiệp...).\n\n` +
        `👉 **Cách chơi:** Nhắn đáp án có dấu hoặc không dấu vào kênh chat. Người đúng đầu tiên thắng.\n` +
        `⏱️ **Thời gian:** ${QUESTION_MS / 1000} giây/câu. Hết giờ sẽ đổi câu mới; bỏ trống ${MAX_TIMEOUTS} câu liên tiếp game kết thúc.\n` +
        `🎁 **Thưởng:** +${REWARD.linhThach} Linh Thạch & +${REWARD.tuVi} Tu Vi; đoán trong ${FAST_SECONDS}s được thêm +${FAST_BONUS} 💎.\n` +
        `🔥 **Chuỗi thắng:** thắng liên tiếp nhiều câu bởi cùng một người được thưởng thêm +5 💎 mỗi bậc từ chuỗi 2 (tối đa +50 💎); người khác thắng xen vào hoặc hết giờ thì đứt chuỗi.\n` +
        `💡 **Gợi ý:** dùng gợi ý thì thưởng giảm còn +${REWARD_AFTER_HINT.linhThach} Linh Thạch & +${REWARD_AFTER_HINT.tuVi} Tu Vi (không có thưởng nhanh).\n` +
        `🏳️ **Đầu hàng:** chỉ người mở trò chơi hoặc người có quyền quản lý tin nhắn mới được kết thúc game.`
    )
    .setFooter({ text: 'Thiên Thư Môn • Ngộ Tính Tối Cao' });

// Interaction handler cho các nút bấm
const handleVuaButtons = async (interaction) => {
    const customId = interaction.customId;
    const channelId = interaction.channelId;
    const game = activeVuaGames.get(channelId);

    if (customId.startsWith('vtv_rules:')) {
        return interaction.reply({ embeds: [RULES_EMBED()], flags: 64 });
    }

    if (!game) {
        return interaction.reply({ content: 'Câu đố này đã kết thúc hoặc không còn tồn tại.', flags: 64 });
    }

    if (customId.startsWith('vtv_hint:')) {
        game.hintUsed = true;
        return interaction.reply({
            content: `💡 **Gợi Ý từ Hiền Giả:**\n*"${game.hint}"*\n\n⚠️ Câu này đã dùng gợi ý nên thưởng giảm còn +${REWARD_AFTER_HINT.linhThach} 💎.`,
            flags: 64
        });
    }

    if (customId.startsWith('vtv_giveup:')) {
        const canEnd = interaction.user.id === game.authorId
            || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
        if (!canEnd) {
            return interaction.reply({ content: '⚠️ Chỉ người mở trò chơi hoặc quản trị viên mới được đầu hàng thay cả kênh.', flags: 64 });
        }
        if (game.solving) {
            return interaction.reply({ content: '⌛ Hiền Giả đang chuyển câu, đạo hữu thử lại sau giây lát.', flags: 64 });
        }

        endGame(channelId);
        const embed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('🏳️ THỬ THÁCH KẾT THÚC')
            .setDescription(
                `Đạo hữu **${getDisplayName(interaction)}** đã tuyên bố đầu hàng trước thử thách!\n\n` +
                `✨ Đáp án chính xác là: **"${game.originalWord}"**`
            )
            .setFooter({ text: 'Thiên Thư Môn • Tu luyện là con đường gian nan' });
        return interaction.update({ embeds: [embed], components: [] });
    }
};

module.exports = {
    commands: [vuatiengvietCommand],
    interactions: {
        'vtv_hint': handleVuaButtons,
        'vtv_rules': handleVuaButtons,
        'vtv_giveup': handleVuaButtons,
    },
    events: [onMessageCreate],
    onShutdown: () => { for (const id of [...activeVuaGames.keys()]) endGame(id); },
    _internal: { activeVuaGames, endGame },
};
