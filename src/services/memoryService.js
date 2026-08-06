const ChatMessage = require('../shared/models/ChatMessage');
const ChatSummary = require('../shared/models/ChatSummary');
const { upsertMessageVector, searchSimilarMessages } = require('./qdrantService');
const { callMultiProviderAI } = require('./aiService');

const EMBEDDING_MIN_LENGTH = 15;
const SUMMARY_TRIGGER_COUNT = 500;

// Set để tránh trigger trùng lặp summary worker
const activeSummaryWork = new Set();

/**
 * Thu thập và xử lý tin nhắn mới từ Discord (Message Collector & Rule Engine)
 */
async function processIncomingMessage(message) {
    if (!message || !message.guild || message.author.bot) return;

    const content = (message.content || '').trim();
    if (!content) return;

    const guildId = message.guild.id;
    const channelId = message.channel.id;
    const messageId = message.id;
    const authorId = message.author.id;
    const username = message.member?.displayName || message.author.username;
    const replyTo = message.reference?.messageId || null;
    const attachments = message.attachments.map(att => att.url);
    const mentions = message.mentions.users.map(u => u.id);
    const createdAt = message.createdAt || new Date();

    // 1. Lưu 100% tin nhắn vào MongoDB
    let savedMsg;
    try {
        savedMsg = await ChatMessage.create({
            guildId,
            channelId,
            messageId,
            authorId,
            username,
            content,
            replyTo,
            attachments,
            mentions,
            embedding: false,
            createdAt
        });
    } catch (err) {
        // Nếu trùng messageId thì bỏ qua
        if (err.code === 11000) return;
        console.error('❌ Lỗi lưu ChatMessage vào MongoDB:', err.message);
        return;
    }

    // 2. Rule Engine: Phân loại tạo Embedding
    // Nếu < 15 ký tự -> Bỏ qua embedding. Nếu >= 15 ký tự -> Đưa vào Qdrant
    if (content.length >= EMBEDDING_MIN_LENGTH) {
        // Run in background non-blocking
        upsertMessageVector({
            messageId,
            guildId,
            channelId,
            authorId,
            username,
            content,
            createdAt
        }).then(success => {
            if (success && savedMsg) {
                ChatMessage.updateOne({ _id: savedMsg._id }, { embedding: true }).catch(() => {});
            }
        }).catch(err => {
            console.warn('⚠️ Vector Upsert Async Error:', err.message);
        });
    }

    // 3. Summary Queue: Kiểm tra tổng số tin nhắn chưa tóm tắt
    checkAndTriggerSummary(guildId, channelId).catch(err => {
        console.warn('⚠️ Check Summary Error:', err.message);
    });
}

/**
 * Kiểm tra xem đã đủ 500 tin nhắn để tạo Summary hay chưa
 */
async function checkAndTriggerSummary(guildId, channelId) {
    const key = `${guildId}:${channelId}`;
    if (activeSummaryWork.has(key)) return;

    // Lấy thời điểm summary gần nhất
    const lastSummary = await ChatSummary.findOne({ guildId, channelId }).sort({ to: -1 });
    const lastDate = lastSummary ? lastSummary.to : new Date(0);

    // Đếm số tin nhắn từ mốc đó đến nay
    const count = await ChatMessage.countDocuments({
        guildId,
        channelId,
        createdAt: { $gt: lastDate }
    });

    if (count >= SUMMARY_TRIGGER_COUNT) {
        activeSummaryWork.add(key);
        try {
            await generateChatSummary(guildId, channelId, lastDate);
        } finally {
            activeSummaryWork.delete(key);
        }
    }
}

/**
 * AI sinh Summary cho 500 tin nhắn
 */
async function generateChatSummary(guildId, channelId, lastDate) {
    console.log(`📝 [Summary Queue] Đang tạo summary cho Server ${guildId} / Channel ${channelId}...`);

    const messages = await ChatMessage.find({
        guildId,
        channelId,
        createdAt: { $gt: lastDate }
    })
    .sort({ createdAt: 1 })
    .limit(SUMMARY_TRIGGER_COUNT);

    if (!messages || messages.length === 0) return;

    const fromDate = messages[0].createdAt;
    const toDate = messages[messages.length - 1].createdAt;

    // Build chat transcript text for LLM
    const textLines = messages.map(m => `[${m.username}]: ${m.content}`);
    const transcriptText = textLines.join('\n');

    const prompt = `Bạn là trợ lý tóm tắt cuộc trò chuyện cho server Discord bang hội Nghịch Thủy Hàn.
Hãy tóm tắt ngắn gọn (dưới 300 từ) các thông tin quan trọng nhất trong 500 tin nhắn chat sau đây.
Tập trung vào:
- Hoạt động bang chiến, bảo trì, thời gian gank/boss
- Các thông báo quan trọng của admin/chủ bang
- Các sự kiện, thỏa thuận hoặc trao đổi nổi bật giữa các thành viên

Nội dung chat:
${transcriptText.slice(0, 8000)}`;

    try {
        const summaryText = await callMultiProviderAI({
            systemPrompt: 'Trả về tóm tắt ngắn gọn dạng gạch đầu dòng, nêu rõ mốc thời gian và nội dung quan trọng.',
            userPrompt: prompt,
            maxTokens: 500,
            temperature: 0.3
        });

        await ChatSummary.create({
            guildId,
            channelId,
            from: fromDate,
            to: toDate,
            summary: summaryText,
            messageCount: messages.length
        });

        console.log(`✅ [Summary Queue] Tạo Summary thành công cho ${messages.length} tin nhắn.`);
    } catch (err) {
        console.error('❌ Lỗi tạo Chat Summary:', err.message);
    }
}

/**
 * Xây dựng Ngữ cảnh Bộ nhớ Tối ưu (Context Builder) khi User hỏi Hiền Giả
 */
async function buildSageContext({ guildId, channelId, query }) {
    // 1. Short-term Memory: 20 tin nhắn gần nhất trong kênh
    let recentChatText = '';
    try {
        const recentMsgs = await ChatMessage.find({ guildId, channelId })
            .sort({ createdAt: -1 })
            .limit(20);
        
        recentMsgs.reverse();
        if (recentMsgs.length > 0) {
            recentChatText = recentMsgs.map(m => `[${m.username}]: ${m.content}`).join('\n');
        }
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Recent Chat:', err.message);
    }

    // 2. Semantic Memory: Qdrant Vector Search Top 5 tin nhắn liên quan nhất
    let vectorMemoryText = '';
    try {
        const vectorResults = await searchSimilarMessages({ text: query, guildId, topK: 5 });
        if (vectorResults.length > 0) {
            vectorMemoryText = vectorResults.map(v => `• [${v.username}]: ${v.content}`).join('\n');
        }
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Vector Memory:', err.message);
    }

    // 3. Summary Memory: 2 summary gần nhất của server/kênh
    let summariesText = '';
    try {
        const summaries = await ChatSummary.find({ guildId })
            .sort({ createdAt: -1 })
            .limit(2);
        
        if (summaries.length > 0) {
            summariesText = summaries.map((s, idx) => `[Tóm tắt ${idx + 1} - ${s.createdAt.toISOString().slice(0, 10)}]:\n${s.summary}`).join('\n\n');
        }
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Summary Memory:', err.message);
    }

    return {
        recentChatText: recentChatText || '(Không có tin nhắn gần đây)',
        vectorMemoryText: vectorMemoryText || '(Không tìm thấy ký ứng liên quan trực tiếp)',
        summariesText: summariesText || '(Chưa có tóm tắt lịch sử)'
    };
}

module.exports = {
    processIncomingMessage,
    buildSageContext,
    generateChatSummary
};
