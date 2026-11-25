const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
} = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const {
    loadBank, createDeck, filterQuestions, buildRound, gradeRound, bar,
    CATEGORY_LABELS, DIFFICULTY_LABELS,
} = require('./quizEngine');

const REWARD_LINH_THACH = 100;      // mỗi đạo hữu trả lời đúng, mỗi câu
const DEFAULT_ANSWER_SECONDS = 12;  // thời gian chọn đáp án, rồi Hiền Giả công bố
const MIN_ANSWER_SECONDS = 5;
const MAX_ANSWER_SECONDS = 30;
const EMPTY_ROUND_LIMIT = 5;        // 5 lượt liên tiếp không ai trả lời thì dừng
const INTRO_DELAY_MS = 4000;
const NEXT_DELAY_MS = 4000;
const MAX_NAMES_SHOWN = 12;
const NO_MENTIONS = { parse: [] };

const COLOR = { intro: '#9B59B6', right: '#2ECC71', wrong: '#E74C3C', empty: '#95A5A6', end: '#34495E' };
const LETTER_EMOJI = { A: '🇦', B: '🇧', C: '🇨', D: '🇩', E: '🇪' };

// Ngân hàng câu hỏi (nạp một lần). Lỗi file thì game báo lỗi thân thiện, bot vẫn chạy.
let BANK = { questions: [], skipped: [] };
let bankError = null;
try {
    BANK = loadBank();
    if (BANK.skipped.length) console.warn(`⚠️ [ThongMinh] Bỏ qua ${BANK.skipped.length} câu hỏi lỗi: ${BANK.skipped.join(', ')}`);
} catch (err) {
    bankError = err;
    console.error('❌ [ThongMinh] Không nạp được ngân hàng câu hỏi:', err.message);
}

// Các sòng đang chạy theo kênh: channelId -> game
const games = new Map();

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const unix = (ms) => Math.floor(ms / 1000);

// ───────────────────────────── Lời của Hiền Giả ─────────────────────────────

const SAGE_LINES = {
    allRight: [
        'Hay lắm! Cả đám đều thấu đạo, Lão phu phải nhìn các ngươi bằng con mắt khác rồi.',
        'Toàn trúng cả! Thiên Thư Môn quả là ngọa hổ tàng long.',
    ],
    someRight: [
        'Có người ngộ đạo, có người còn mơ màng — hồng trần vốn là vậy.',
        'Kẻ đúng thì thưởng, kẻ sai thì ráng tu thêm. Câu sau Lão phu ra khó hơn đấy!',
        'Không tệ, không tệ. Vài đạo hữu đã không làm Lão phu thất vọng.',
    ],
    noneRight: [
        'Hừm, chẳng ai đoán trúng. Xem ra Lão phu ra đề hơi hiểm, hay các ngươi chưa chịu đọc kỹ?',
        'Cả đám trượt vỏ chuối! Về ôn lại bí kíp rồi quay lại nhé, tiểu tử.',
    ],
    noAnswer: [
        'Lặng như tờ... Có ai còn ở đó không?',
        'Chẳng ai dám lên tiếng sao? Lão phu đợi đấy.',
    ],
};

function listNames(winners) {
    if (!winners.length) return '—';
    const shown = winners.slice(0, MAX_NAMES_SHOWN).map((w) => `**${w.name}**`).join(', ');
    return winners.length > MAX_NAMES_SHOWN ? `${shown} … và ${winners.length - MAX_NAMES_SHOWN} đạo hữu khác` : shown;
}

function sessionBoard(game) {
    const top = [...game.scores.values()].sort((a, b) => b.correct - a.correct).slice(0, 5);
    if (!top.length) return 'Chưa có đạo hữu nào ghi điểm.';
    return top.map((p, i) => `${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} **${p.name}** — ${p.correct} câu đúng · +${(p.correct * REWARD_LINH_THACH).toLocaleString('vi-VN')} 💎`).join('\n');
}

// ───────────────────────────── Giao diện ─────────────────────────────

function answerRows(game, roundId, { reveal = null } = {}) {
    const round = game.round;
    const row = new ActionRowBuilder().addComponents(round.options.map((o) => {
        const btn = new ButtonBuilder()
            .setCustomId(`tm:${game.channelId}:${roundId}:${o.letter}`)
            .setLabel(o.letter)
            .setEmoji(LETTER_EMOJI[o.letter]);
        if (!reveal) return btn.setStyle(ButtonStyle.Primary);
        return btn.setStyle(o.correct ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(true);
    }));
    return [row];
}

function optionLines(round, { reveal = false, counts = null, total = 0 } = {}) {
    return round.options.map((o) => {
        const mark = reveal ? (o.correct ? '✅' : '▫️') : LETTER_EMOJI[o.letter];
        const text = reveal && o.correct ? `**${o.text}**` : o.text;
        const stat = reveal && counts ? `  \`${bar(counts[o.letter], total)}\` ${counts[o.letter]}` : '';
        return `${mark} **${o.letter}.** ${text}${stat}`;
    }).join('\n');
}

function questionEmbed(game) {
    const { round } = game;
    const q = round.question;
    const diff = DIFFICULTY_LABELS[q.difficulty] || { label: q.difficulty, color: COLOR.intro };
    return new EmbedBuilder()
        .setColor(diff.color)
        .setAuthor({ name: `🧙‍♂️ Thiên Thư Hiền Giả ra đề • Câu ${game.asked}` })
        .setTitle(`❓ ${q.question}`)
        .setDescription(optionLines(round))
        .addFields(
            { name: '📚 Chủ đề', value: CATEGORY_LABELS[q.category] || q.category, inline: true },
            { name: '🎚️ Độ khó', value: diff.label, inline: true },
            { name: '⏳ Công bố đáp án', value: `<t:${unix(round.endsAt)}:R>`, inline: true },
        )
        .setFooter({ text: `Bấm nút để chọn • mỗi người chọn 1 lần • đúng nhận +${REWARD_LINH_THACH} 💎` });
}

function revealEmbed(game, grade) {
    const { round } = game;
    const q = round.question;
    const correct = round.options.find((o) => o.correct);
    const { winners, answered, counts } = grade;

    let line;
    let color;
    if (!answered) { line = pick(SAGE_LINES.noAnswer); color = COLOR.empty; }
    else if (!winners.length) { line = pick(SAGE_LINES.noneRight); color = COLOR.wrong; }
    else if (winners.length === answered && answered > 1) { line = pick(SAGE_LINES.allRight); color = COLOR.right; }
    else { line = pick(SAGE_LINES.someRight); color = COLOR.right; }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `🧙‍♂️ Thiên Thư Hiền Giả công bố • Câu ${game.asked}` })
        .setTitle(`❓ ${q.question}`)
        .setDescription(
            `${optionLines(round, { reveal: true, counts, total: answered })}\n\n` +
            `✅ **Đáp án đúng: ${correct.letter}. ${correct.text}**\n` +
            (q.explanation ? `📖 *${q.explanation}*\n\n` : '\n') +
            `💬 *${line}*`
        )
        .addFields({
            name: `🏆 Đáp đúng (${winners.length}/${answered}) ${winners.length ? `· +${REWARD_LINH_THACH} 💎 mỗi người` : ''}`.trim(),
            value: listNames(winners),
        });

    if (game.emptyRounds >= EMPTY_ROUND_LIMIT) {
        embed.setFooter({ text: `⚠️ ${EMPTY_ROUND_LIMIT} lượt liền không ai trả lời — Hiền Giả sắp thu đề...` });
    } else {
        embed.setFooter({ text: `Câu kế tiếp sau ${NEXT_DELAY_MS / 1000} giây • không ai trả lời ${game.emptyRounds}/${EMPTY_ROUND_LIMIT} lượt` });
    }
    return embed;
}

// ───────────────────────────── Vòng đời game ─────────────────────────────

function endGame(channelId) {
    const game = games.get(channelId);
    if (!game) return null;
    clearTimeout(game.timer);
    game.timer = null;
    games.delete(channelId);
    return game;
}

function summaryEmbed(game, title, reason) {
    return new EmbedBuilder()
        .setColor(COLOR.end)
        .setTitle(title)
        .setDescription(
            `${reason}\n\n` +
            `📜 **Số câu đã ra:** ${game.asked}\n` +
            `🏅 **Bảng vàng phiên này:**\n${sessionBoard(game)}\n\n` +
            `Gõ \`/thongminh\` để Hiền Giả mở trận mới bất cứ lúc nào!`
        )
        .setFooter({ text: 'Thiên Thư Môn • Ai Thông Minh Hơn Thiên Thư Môn?' });
}

async function runRound(game) {
    if (games.get(game.channelId) !== game) return;

    const question = game.deck.next();
    game.asked += 1;
    game.round = {
        id: `${game.asked}-${Date.now().toString(36)}`,
        ...buildRound(question),
        answers: new Map(),      // userId -> { letter, name }
        closed: false,
        endsAt: Date.now() + game.answerSeconds * 1000,
        message: null,
    };

    try {
        game.round.message = await game.channel.send({
            embeds: [questionEmbed(game)],
            components: answerRows(game, game.round.id),
        });
    } catch (err) {
        console.error('❌ [ThongMinh] Không gửi được câu hỏi:', err.message);
        endGame(game.channelId);
        return;
    }
    if (games.get(game.channelId) !== game) return;

    game.timer = setTimeout(() => {
        revealRound(game).catch((err) => console.error('❌ [ThongMinh] revealRound:', err));
    }, game.answerSeconds * 1000);
}

/** Đóng lượt, công bố đáp án, trả thưởng, rồi hẹn câu kế tiếp (hoặc dừng nếu quá 5 lượt trống). */
async function revealRound(game, { scheduleNext = true } = {}) {
    const round = game.round;
    if (!round || round.closed || games.get(game.channelId) !== game) return;
    round.closed = true; // từ giây này không nhận thêm đáp án
    clearTimeout(game.timer);

    const grade = gradeRound(round, round.answers);
    game.emptyRounds = grade.answered === 0 ? game.emptyRounds + 1 : 0;
    for (const w of grade.winners) {
        const entry = game.scores.get(w.userId) || { name: w.name, correct: 0 };
        entry.name = w.name;
        entry.correct += 1;
        game.scores.set(w.userId, entry);
    }

    // Công bố ngay cho người chơi, trả thưởng ngay sau đó
    await round.message?.edit({
        embeds: [revealEmbed(game, grade)],
        components: answerRows(game, round.id, { reveal: true }),
    }).catch((err) => console.warn('⚠️ [ThongMinh] Không sửa được tin câu hỏi:', err.message));

    await Promise.allSettled([...round.answers].map(async ([userId, a]) => {
        const correct = a.letter === round.correctLetter;
        const profile = await UserProfile.getOrCreate(userId, a.name);
        const inc = { 'stats.quizAnswered': 1 };
        if (correct) inc['stats.quizCorrect'] = 1;
        await profile.incLinhThach(correct ? REWARD_LINH_THACH : 0, { inc });
    })).then((results) => {
        results.filter((r) => r.status === 'rejected').forEach((r) => console.error('❌ [ThongMinh] Lỗi trả thưởng:', r.reason?.message));
    });

    if (!scheduleNext || games.get(game.channelId) !== game) return;

    if (game.emptyRounds >= EMPTY_ROUND_LIMIT) {
        endGame(game.channelId);
        await game.channel.send({
            embeds: [summaryEmbed(game, '🛑 HIỀN GIẢ THU ĐỀ',
                `⏳ Đã **${EMPTY_ROUND_LIMIT} lượt liên tiếp** không có đạo hữu nào trả lời. Lão phu xin khép trận, đợi lần luận đạo sau.`)],
            allowedMentions: NO_MENTIONS,
        }).catch(() => {});
        return;
    }

    game.timer = setTimeout(() => {
        runRound(game).catch((err) => console.error('❌ [ThongMinh] runRound:', err));
    }, NEXT_DELAY_MS);
}

// ───────────────────────────── Lệnh ─────────────────────────────

const thongMinhCommand = {
    data: new SlashCommandBuilder()
        .setName('thongminh')
        .setDescription('🧠 Ai Thông Minh Hơn Thiên Thư Môn? Hiền Giả ra đề trắc nghiệm, ai cũng được thi')
        .addIntegerOption((o) => o.setName('thoigian')
            .setDescription(`Số giây chọn đáp án mỗi câu (${MIN_ANSWER_SECONDS}–${MAX_ANSWER_SECONDS}, mặc định ${DEFAULT_ANSWER_SECONDS})`)
            .setMinValue(MIN_ANSWER_SECONDS)
            .setMaxValue(MAX_ANSWER_SECONDS))
        .addStringOption((o) => o.setName('dokho')
            .setDescription('Chỉ ra đề theo độ khó (mặc định: tất cả)')
            .addChoices(
                { name: '🎲 Tất cả', value: 'all' },
                ...Object.entries(DIFFICULTY_LABELS).map(([value, d]) => ({ name: d.label, value }))
            ))
        .addStringOption((o) => o.setName('chude')
            .setDescription('Chỉ ra đề theo chủ đề (mặc định: tất cả)')
            .addChoices(
                { name: '🎲 Tất cả', value: 'all' },
                ...Object.entries(CATEGORY_LABELS).map(([value, name]) => ({ name, value }))
            )),

    async execute(interaction) {
        const channelId = interaction.channelId;
        if (bankError || !BANK.questions.length) {
            return interaction.reply({ content: '⚠️ Hiền Giả chưa tìm thấy sách đề thi (ngân hàng câu hỏi lỗi). Báo quản trị viên giúp nhé!', flags: 64 });
        }
        if (games.has(channelId)) {
            return interaction.reply({ content: '⚠️ Kênh này đang có trận **Ai Thông Minh Hơn Thiên Thư Môn** rồi, cứ vào thi thôi!', flags: 64 });
        }

        const answerSeconds = interaction.options.getInteger('thoigian') || DEFAULT_ANSWER_SECONDS;
        const difficulty = interaction.options.getString('dokho') || 'all';
        const category = interaction.options.getString('chude') || 'all';
        const pool = filterQuestions(BANK.questions, { difficulty, category });
        if (!pool.length) {
            return interaction.reply({ content: '⚠️ Không có câu hỏi nào khớp bộ lọc độ khó/chủ đề này.', flags: 64 });
        }

        const game = {
            channelId,
            channel: interaction.channel,
            hostId: interaction.user.id,
            answerSeconds,
            deck: createDeck(pool),
            asked: 0,
            emptyRounds: 0,
            scores: new Map(),   // userId -> { name, correct }
            round: null,
            timer: null,
        };
        games.set(channelId, game);

        const filters = [
            difficulty !== 'all' ? DIFFICULTY_LABELS[difficulty].label : null,
            category !== 'all' ? CATEGORY_LABELS[category] : null,
        ].filter(Boolean);

        const intro = new EmbedBuilder()
            .setColor(COLOR.intro)
            .setTitle('🧙‍♂️ AI THÔNG MINH HƠN THIÊN THƯ MÔN? 🧙‍♂️')
            .setDescription(
                `Lão phu — **Thiên Thư Hiền Giả** — xin ra đề thử tài các đạo hữu về thế giới **Nghịch Thủy Hàn**!\n\n` +
                `📜 **Thể lệ**\n` +
                `• Mỗi lượt một câu trắc nghiệm **A · B · C · D**, **tất cả mọi người** cùng được thi.\n` +
                `• Bấm nút chọn đáp án trong **${answerSeconds} giây** (mỗi người chọn **một lần**, không đổi được).\n` +
                `• Hết giờ Hiền Giả **công bố đáp án**; ai chọn đúng nhận **+${REWARD_LINH_THACH} 💎 Linh Thạch** mỗi câu.\n` +
                `• Quá **${EMPTY_ROUND_LIMIT} lượt liên tiếp** không ai trả lời, Lão phu sẽ thu đề. Muốn chơi lại cứ gõ \`/thongminh\`.\n` +
                (filters.length ? `\n🎯 **Bộ đề:** ${filters.join(' · ')} (${pool.length} câu)\n` : `\n🎯 **Bộ đề:** ${pool.length} câu\n`) +
                `\n⏳ Câu đầu tiên sắp xuất hiện, các đạo hữu chuẩn bị nhé!`
            )
            .setFooter({ text: `Thiên Thư Môn • ${interaction.member?.displayName || interaction.user.username} khai mở trận` });

        await interaction.reply({ embeds: [intro], allowedMentions: NO_MENTIONS });
        game.timer = setTimeout(() => {
            runRound(game).catch((err) => console.error('❌ [ThongMinh] runRound:', err));
        }, INTRO_DELAY_MS);
    },
};

const stopCommand = {
    data: new SlashCommandBuilder()
        .setName('thongminh-dung')
        .setDescription('⛔ Dừng trận Ai Thông Minh Hơn Thiên Thư Môn (người mở trận hoặc quản trị viên)'),
    async execute(interaction) {
        const game = games.get(interaction.channelId);
        if (!game) return interaction.reply({ content: 'Kênh này không có trận nào đang diễn ra.', flags: 64 });

        const allowed = interaction.user.id === game.hostId
            || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
        if (!allowed) {
            return interaction.reply({ content: '⚠️ Chỉ người mở trận hoặc quản trị viên mới được dừng trận.', flags: 64 });
        }

        // Câu đang dở: công bố đáp án trước (và trả thưởng) rồi mới đóng
        await interaction.deferReply();
        await revealRound(game, { scheduleNext: false });
        endGame(interaction.channelId);
        await interaction.editReply({
            embeds: [summaryEmbed(game, '⛔ TRẬN ĐÃ KẾT THÚC', `Trận luận đạo đã được **${getDisplayName(interaction)}** khép lại.`)],
            allowedMentions: NO_MENTIONS,
        });
    },
};

// ───────────────────────────── Chọn đáp án ─────────────────────────────

const handleAnswer = async (interaction) => {
    const [, channelId, roundId, letter] = interaction.customId.split(':');
    const game = games.get(interaction.channelId);
    const round = game?.round;

    if (!game || game.channelId !== channelId || !round || round.id !== roundId || round.closed) {
        return interaction.reply({ content: '⌛ Câu này đã khép lại rồi, đạo hữu chú ý câu kế tiếp nhé!', flags: 64 });
    }
    if (!round.options.some((o) => o.letter === letter)) return;

    const previous = round.answers.get(interaction.user.id);
    if (previous) {
        return interaction.reply({ content: `🔒 Đạo hữu đã chọn **${previous.letter}** rồi, không đổi được nữa. Chờ Hiền Giả công bố!`, flags: 64 });
    }

    round.answers.set(interaction.user.id, { letter, name: getDisplayName(interaction) });
    return interaction.reply({ content: `✅ Đã ghi nhận đáp án **${letter}** của đạo hữu. Chờ Hiền Giả công bố nhé!`, flags: 64 });
};

module.exports = {
    commands: [thongMinhCommand, stopCommand],
    interactions: { tm: handleAnswer },
    drainInteractions: ['tm'],
    // Bot tắt êm: công bố đáp án câu đang dở (trả thưởng đầy đủ) rồi đóng trận
    onShutdown: async () => {
        for (const game of [...games.values()]) {
            await revealRound(game, { scheduleNext: false }).catch(() => {});
            endGame(game.channelId);
            await game.channel.send({
                embeds: [summaryEmbed(game, '🛠️ HIỀN GIẢ TẠM NGHỈ', 'Bot đang khởi động lại để bảo trì, trận luận đạo tạm dừng. Hẹn đạo hữu sau ít phút!')],
                allowedMentions: NO_MENTIONS,
            }).catch(() => {});
        }
    },
    _internal: { games, runRound, revealRound, BANK, REWARD_LINH_THACH, EMPTY_ROUND_LIMIT },
};
