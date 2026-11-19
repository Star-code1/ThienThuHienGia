/**
 * Lưu phiên hội thoại AI theo (server, kênh, người dùng, bot).
 */
const AiSession = require('../shared/models/AiSession');

const MAX_TURNS_KEPT = 10;          // giữ 10 lượt hỏi-đáp gần nhất
const MAX_MESSAGE_CHARS = 2000;     // cắt bớt câu quá dài khi lưu
const MAX_MESSAGE_IDS = 30;

const keyOf = ({ guildId, channelId, userId, bot }) => ({ guildId: guildId || 'dm', channelId, userId, bot });

async function getSession(key) {
    return AiSession.findOne(keyOf(key)).lean();
}

/** Lịch sử [{role, content}] để gửi kèm câu hỏi mới. */
async function getHistory(key) {
    const s = await getSession(key).catch(() => null);
    return s?.messages || [];
}

/** Ghi thêm 1 lượt hỏi-đáp. Trả về số lượt của phiên. */
async function appendTurn(key, { question, answer, messageId }) {
    const clip = (t) => String(t).slice(0, MAX_MESSAGE_CHARS);
    const update = {
        $push: {
            messages: { $each: [{ role: 'user', content: clip(question) }, { role: 'assistant', content: clip(answer) }], $slice: -MAX_TURNS_KEPT * 2 },
            ...(messageId ? { messageIds: { $each: [messageId], $slice: -MAX_MESSAGE_IDS } } : {}),
        },
        $inc: { turns: 1 },
        $set: { lastActiveAt: new Date() },
    };
    const s = await AiSession.findOneAndUpdate(keyOf(key), update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).lean();
    return s.turns;
}

/** Thêm sẵn 1 câu trả lời của bot vào phiên (khi người khác reply vào tin của bot). */
async function seedAssistantMessage(key, content) {
    await AiSession.findOneAndUpdate(keyOf(key), {
        $push: { messages: { $each: [{ role: 'assistant', content: String(content).slice(0, MAX_MESSAGE_CHARS) }], $slice: -MAX_TURNS_KEPT * 2 } },
        $set: { lastActiveAt: new Date() },
    }, { upsert: true, setDefaultsOnInsert: true });
}

async function resetSession(key) {
    await AiSession.deleteOne(keyOf(key));
}

/** Tìm phiên chứa tin nhắn trả lời của bot (để reply nối tiếp). */
async function findByMessageId(messageId) {
    return AiSession.findOne({ messageIds: messageId }).lean();
}

module.exports = { MAX_TURNS_KEPT, getSession, getHistory, appendTurn, seedAssistantMessage, resetSession, findByMessageId };
