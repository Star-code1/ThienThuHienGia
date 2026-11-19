/**
 * Luồng hỏi-đáp dùng chung cho Thiên Thư Hiền Giả và Tiểu Hàn:
 * giao diện câu trả lời, hiện chữ dần (Tiểu Hàn), lưu phiên, nút Hỏi tiếp / Phiên mới.
 */
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { generateSageResponseWithContext } = require('../../services/aiService');
const { askTieuHan, StaminaExhaustedError } = require('../../services/tieuHanService');
const sessions = require('../../services/aiSessionService');
const { buildVoiceButtonsRow } = require('../../shared/voiceChannels');
const { SESSION_TTL_SECONDS } = require('../../shared/models/AiSession');

const STREAM_EDIT_INTERVAL_MS = 1200;
const VOICE_QUESTION_RE = /voice|phòng (thoại|nói)|kênh (thoại|nói)|link (vào )?(trận|team)|\b(push|mid|def)\b/i;

const PERSONAS = {
    hiengia: {
        name: 'Thiên Thư Hiền Giả',
        command: '/hiengia',
        color: 0x7289DA,
        footer: '☯️ Thiên Thư Hiền Giả',
        thinking: '🔮 *Hiền Giả đang suy ngẫm…*',
        errorText: '🧙‍♂️ Bản tôn đang nhập định bế quan, tạm thời chưa thể đáp lời đạo hữu. Thử lại sau ít khắc nhé!',
    },
    tieuhan: {
        name: 'Tiểu Hàn',
        command: '/tieuhan',
        color: 0x4FC3F7,
        footer: '❄️ Tiểu Hàn • wikinghichthuyhan.com',
        thinking: '❄️ *Tiểu Hàn đang lật sách bí kíp…*',
        errorText: '❄️ Tiểu Hàn đang bận chút xíu, chủ nhân hỏi lại sau giây lát nha!',
        siteUrl: 'https://wikinghichthuyhan.com',
    },
};

const clip = (text, max) => {
    const t = String(text ?? '');
    return t.length <= max ? t : t.slice(0, max - 1) + '…';
};

const quote = (question) => clip(question, 300).split('\n').map((l) => `> ${l}`).join('\n');

/** Bỏ phần trích dẫn câu hỏi ở đầu mô tả embed, chỉ lấy câu trả lời. */
function answerFromEmbedDescription(description) {
    return String(description || '').split('\n').filter((l) => !l.startsWith('> ')).join('\n').trim();
}

function buildEmbed({ bot, asker, question, body, turn, sources = [], state = 'done' }) {
    const p = PERSONAS[bot];
    const ttlHours = SESSION_TTL_SECONDS / 3600;
    const footer = state === 'done'
        ? `${p.footer} • Phiên: lượt ${turn} • tự xóa sau ${ttlHours} giờ không dùng`
        : p.footer;
    const embed = new EmbedBuilder()
        .setColor(state === 'error' ? 0xE74C3C : p.color)
        .setAuthor({ name: `${asker.name} hỏi ${p.name}`, iconURL: asker.avatarURL })
        .setDescription(clip(`${quote(question)}\n\n${body}`, 4096))
        .setFooter({ text: footer });
    if (state === 'done') embed.setTimestamp();
    if (sources.length > 0) {
        embed.addFields({
            name: '📚 Xem thêm',
            value: clip(sources.map((s) => `• [${clip(s.title, 80)}](${s.url})`).join('\n'), 1024),
        });
    }
    return embed;
}

function buildButtons({ bot, ownerId, question }) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ai:more:${bot}:${ownerId}`).setLabel('Hỏi tiếp').setEmoji('💬').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ai:reset:${bot}:${ownerId}`).setLabel('Phiên mới').setEmoji('🧹').setStyle(ButtonStyle.Secondary)
    );
    if (PERSONAS[bot].siteUrl) {
        row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(PERSONAS[bot].siteUrl).setLabel('Wiki').setEmoji('🌐'));
    }
    const rows = [row];
    if (bot === 'hiengia' && VOICE_QUESTION_RE.test(question)) rows.push(buildVoiceButtonsRow());
    return rows;
}

// Lưu tạm câu trả lời của Tiểu Hàn cho câu hỏi trùng (tránh tốn lượt stamina)
const ANSWER_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const answerCache = new Map(); // normQuestion -> { answer, at }
const normQuestion = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

function getCachedAnswer(question) {
    const hit = answerCache.get(normQuestion(question));
    if (hit && Date.now() - hit.at < ANSWER_CACHE_TTL_MS) return hit.answer;
    return null;
}
function setCachedAnswer(question, answer) {
    answerCache.set(normQuestion(question), { answer, at: Date.now() });
    if (answerCache.size > 500) answerCache.delete(answerCache.keys().next().value);
}

/** "phút/giờ còn lại" từ mốc epoch milli. */
function refillText(nextRefillAt) {
    if (!nextRefillAt) return '';
    const ms = nextRefillAt - Date.now();
    if (ms <= 0) return 'sắp hồi';
    const mins = Math.ceil(ms / 60000);
    if (mins < 60) return `~${mins} phút nữa`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `~${h} giờ ${m} phút nữa` : `~${h} giờ nữa`;
}

async function sageAnswer({ question, history, key, displayName }) {
    return generateSageResponseWithContext({
        question,
        guildId: key.guildId,
        channelId: key.channelId,
        displayName,
        history,
    });
}

/** Gọi AI tương ứng. onDelta chỉ có với Tiểu Hàn (hiện chữ dần). */
async function generate(bot, { question, history, key, displayName, onDelta }) {
    if (bot !== 'tieuhan') {
        return sageAnswer({ question, history, key, displayName });
    }

    // Chỉ dùng cache cho câu hỏi mới (không có lịch sử) để tránh trả lời lệch ngữ cảnh phiên
    if (history.length === 0) {
        const cached = getCachedAnswer(question);
        if (cached) {
            if (onDelta) onDelta(cached);
            return { answer: cached, sources: [] };
        }
    }

    try {
        const { answer } = await askTieuHan([...history, { role: 'user', content: question }], { onDelta });
        if (history.length === 0) setCachedAnswer(question, answer);
        return { answer, sources: [] };
    } catch (err) {
        if (!(err instanceof StaminaExhaustedError)) throw err;
        // Hết lượt -> nhờ Hiền Giả trả lời thay bằng kho kiến thức wiki
        const when = refillText(err.stamina?.nextRefillAt);
        const note = `❄️ *Tiểu Hàn đang nghỉ lấy sức${when ? ` (hồi lượt ${when})` : ''} — Hiền Giả xin luận thay:*\n\n`;
        const sage = await sageAnswer({ question, history, key, displayName });
        return { answer: note + sage.answer, sources: sage.sources, fellBack: true };
    }
}

/**
 * Chạy 1 lượt hỏi-đáp.
 * @param send  (payload) => Promise<Message>  gửi tin đầu tiên (đang suy nghĩ)
 * @param edit  (payload) => Promise<any>      sửa tin đó
 */
async function runTurn({ bot, key, question, asker, send, edit }) {
    const session = await sessions.getSession(key).catch(() => null);
    const history = session?.messages || [];
    const turn = (session?.turns || 0) + 1;
    const p = PERSONAS[bot];

    const message = await send({ embeds: [buildEmbed({ bot, asker, question, body: p.thinking, state: 'thinking' })], components: [] });

    // Hiện chữ dần: gom lại, tối đa 1 lần sửa mỗi STREAM_EDIT_INTERVAL_MS
    let latest = '';
    let lastEdit = 0;
    let editing = null;
    const onDelta = (text) => {
        latest = text;
        if (editing || Date.now() - lastEdit < STREAM_EDIT_INTERVAL_MS) return;
        lastEdit = Date.now();
        editing = edit({ embeds: [buildEmbed({ bot, asker, question, body: `${latest} ▌`, state: 'streaming' })] })
            .catch(() => {})
            .finally(() => { editing = null; });
    };

    try {
        const { answer, sources } = await generate(bot, { question, history, key, displayName: asker.name, onDelta });
        await editing;
        await edit({
            embeds: [buildEmbed({ bot, asker, question, body: answer, turn, sources })],
            components: buildButtons({ bot, ownerId: key.userId, question }),
        });
        await sessions.appendTurn(key, { question, answer, messageId: message?.id }).catch((e) => console.warn('[AI Session] Lỗi lưu phiên:', e.message));
    } catch (err) {
        console.error(`❌ [${bot}] Lỗi trả lời:`, err.message);
        await editing;
        await edit({
            embeds: [buildEmbed({ bot, asker, question, body: latest ? `${latest}\n\n*(bị ngắt giữa chừng)*` : p.errorText, state: 'error' })],
            components: [],
        }).catch(() => {});
    }
}

module.exports = { PERSONAS, runTurn, generate, refillText, buildEmbed, buildButtons, answerFromEmbedDescription, VOICE_QUESTION_RE };
