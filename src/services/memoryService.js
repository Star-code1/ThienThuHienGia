const ChatMessage = require('../shared/models/ChatMessage');
const ChatSummary = require('../shared/models/ChatSummary');
const { upsertMessageVector, searchSimilarMessages } = require('./qdrantService');
const { callMultiProviderAI } = require('./aiService');
const { resolveUserMentions } = require('../shared/utils/nameHelper');
const { findMentionedMembers, escapeRegex } = require('../shared/utils/memberMatch');

const EMBEDDING_MIN_LENGTH = 15;
const SUMMARY_TRIGGER_COUNT = 500;
// Giới hạn độ dài transcript gửi AI tóm tắt; chỉ tin nhắn thực sự nằm trong
// giới hạn này mới được tính là "đã tóm tắt".
const SUMMARY_CHAR_BUDGET = 12000;
const SUMMARY_LINE_MAX_CHARS = 400;
// Tóm tắt thất bại -> chờ bấy lâu mới thử lại, tránh mỗi tin nhắn mới lại gọi AI đốt quota
const SUMMARY_FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

// Recent chat: ưu tiên kênh đang hỏi, chỉ lấy ít tin từ các kênh public khác
const RECENT_CURRENT_CHANNEL_LIMIT = 15;
const RECENT_OTHER_CHANNELS_LIMIT = 6;

// Set để tránh trigger trùng lặp summary worker
const activeSummaryWork = new Set();
// key -> timestamp được phép thử lại sau khi tóm tắt thất bại
const summaryRetryAt = new Map();

/**
 * Thu thập và xử lý tin nhắn mới từ Discord (Message Collector & Rule Engine)
 */
async function processIncomingMessage(message) {
    if (!message || !message.guild || message.author.bot) return;

    const channelId = message.channel.id;

    // Phân quyền kênh riêng tư: Kiểm tra danh sách channel bị cấm lưu vết
    const excludedChannels = (process.env.EXCLUDED_CHANNEL_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
    if (excludedChannels.includes(channelId)) {
        return; // Bỏ qua 100% không lưu vết kênh cấm này
    }

    const rawContent = (message.content || '').trim();
    if (!rawContent) return;

    // Chuyển đổi các tag <@ID> trong tin nhắn thành @BiệtDanh để AI dễ dàng nhận diện tên thành viên
    const content = resolveUserMentions(message, rawContent);

    const guildId = message.guild.id;
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
    if (Date.now() < (summaryRetryAt.get(key) || 0)) return;

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
            const ok = await generateChatSummary(guildId, channelId, lastDate);
            if (ok) {
                summaryRetryAt.delete(key);
            } else {
                summaryRetryAt.set(key, Date.now() + SUMMARY_FAILURE_COOLDOWN_MS);
                console.warn(`⏸️ [Summary Queue] ${key} tạm dừng tóm tắt ${SUMMARY_FAILURE_COOLDOWN_MS / 60000} phút do lỗi.`);
            }
        } finally {
            activeSummaryWork.delete(key);
        }
    }
}

/**
 * Cắt danh sách tin nhắn (đã sort cũ -> mới) sao cho transcript không vượt budget.
 * Trả về các dòng transcript + số tin nhắn thực sự được đưa vào.
 */
function buildSummaryTranscript(messages, budget = SUMMARY_CHAR_BUDGET) {
    const lines = [];
    let used = 0;
    for (const m of messages) {
        let content = String(m.content || '');
        if (content.length > SUMMARY_LINE_MAX_CHARS) content = content.slice(0, SUMMARY_LINE_MAX_CHARS - 1) + '…';
        const line = `[${m.username}]: ${content}`;
        // Luôn lấy ít nhất 1 tin để tiến độ không bị kẹt
        if (lines.length > 0 && used + line.length + 1 > budget) break;
        lines.push(line);
        used += line.length + 1;
    }
    return { lines, includedCount: lines.length };
}

/**
 * AI sinh Summary cho lô tin nhắn chưa tóm tắt.
 * Chỉ ghi nhận mốc `to` tới tin nhắn cuối cùng AI thực sự đọc được; phần còn lại
 * sẽ được tóm tắt ở lượt sau.
 * @returns {Promise<boolean>} true nếu tạo summary thành công
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

    if (!messages || messages.length === 0) return true;

    const { lines, includedCount } = buildSummaryTranscript(messages);
    const included = messages.slice(0, includedCount);
    const fromDate = included[0].createdAt;
    const toDate = included[included.length - 1].createdAt;

    const prompt = `Bạn là trợ lý tóm tắt cuộc trò chuyện cho server Discord bang hội Nghịch Thủy Hàn.
Hãy tóm tắt ngắn gọn (dưới 300 từ) các thông tin quan trọng nhất trong ${includedCount} tin nhắn chat sau đây.
Tập trung vào:
- Hoạt động bang chiến, bảo trì, thời gian gank/boss
- Các thông báo quan trọng của admin/chủ bang
- Các sự kiện, thỏa thuận hoặc trao đổi nổi bật giữa các thành viên

Nội dung chat:
${lines.join('\n')}`;

    try {
        const summaryText = await callMultiProviderAI({
            systemPrompt: 'Trả về tóm tắt ngắn gọn dạng gạch đầu dòng, nêu rõ mốc thời gian và nội dung quan trọng.',
            userPrompt: prompt,
            maxTokens: 700,
            temperature: 0.3
        });

        await ChatSummary.create({
            guildId,
            channelId,
            from: fromDate,
            to: toDate,
            summary: summaryText,
            messageCount: includedCount
        });

        console.log(`✅ [Summary Queue] Tạo Summary thành công cho ${includedCount}/${messages.length} tin nhắn.`);
        return true;
    } catch (err) {
        console.error('❌ Lỗi tạo Chat Summary:', err.message);
        return false;
    }
}

/**
 * Xây dựng Ngữ cảnh Bộ nhớ Tối ưu (Context Builder) phân quyền phân cấp:
 * Kênh hỏi X sẽ có quyền đọc: Tất cả Kênh Public + Kênh X (nếu X là Private)
 * Tuyệt đối KHÔNG đọc từ các kênh Private Y khác (Y != X)
 */
async function buildSageContext({ guildId, channelId, query, guild }) {
    const { PermissionFlagsBits } = require('discord.js');
    const client = require('../core/client');

    let allowedChannelIds = [channelId];

    try {
        const targetGuild = guild || (client.guilds?.cache.get(guildId));
        if (targetGuild) {
            const publicChannelIds = targetGuild.channels.cache
                .filter(c => c.isTextBased() && c.permissionsFor(targetGuild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
                .map(c => c.id);
            allowedChannelIds = Array.from(new Set([...publicChannelIds, channelId]));
        }
    } catch (err) {
        console.warn('⚠️ Lỗi tính toán allowedChannelIds:', err.message);
    }

    // 1. Short-term Memory: ưu tiên tin nhắn gần nhất của KÊNH ĐANG HỎI,
    //    bổ sung một ít tin từ các kênh public khác (ghi rõ tên kênh)
    let recentChatText = '';
    const recentTask = (async () => { try {
        const otherChannelIds = allowedChannelIds.filter(id => id !== channelId);
        const [currentMsgs, otherMsgs] = await Promise.all([
            ChatMessage.find({ guildId, channelId })
                .sort({ createdAt: -1 })
                .limit(RECENT_CURRENT_CHANNEL_LIMIT),
            otherChannelIds.length > 0
                ? ChatMessage.find({ guildId, channelId: { $in: otherChannelIds } })
                    .sort({ createdAt: -1 })
                    .limit(RECENT_OTHER_CHANNELS_LIMIT)
                : []
        ]);

        const parts = [];
        if (currentMsgs.length > 0) {
            parts.push('[Kênh hiện tại]\n' + currentMsgs.reverse().map(m => `[${m.username}]: ${m.content}`).join('\n'));
        }
        if (otherMsgs.length > 0) {
            const channelName = id => client.channels?.cache.get(id)?.name || 'kênh khác';
            parts.push('[Các kênh khác]\n' + otherMsgs.reverse().map(m => `#${channelName(m.channelId)} [${m.username}]: ${m.content}`).join('\n'));
        }
        recentChatText = parts.join('\n\n');
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Recent Chat:', err.message);
    } })();

    // 2. Semantic Memory: Qdrant Vector Search Top 5 tin nhắn liên quan nhất (Lọc theo allowedChannelIds)
    let vectorMemoryText = '';
    const vectorTask = (async () => { try {
        const vectorResults = await searchSimilarMessages({ text: query, guildId, allowedChannelIds, topK: 5 });
        if (vectorResults.length > 0) {
            vectorMemoryText = vectorResults.map(v => `• [${v.username}]: ${v.content}`).join('\n');
        }
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Vector Memory:', err.message);
    } })();

    // 3. Summary Memory: 2 summary gần nhất của các kênh được phép
    let summariesText = '';
    const summaryTask = (async () => { try {
        const summaries = await ChatSummary.find({ guildId, channelId: { $in: allowedChannelIds } })
            .sort({ createdAt: -1 })
            .limit(2);
        
        if (summaries.length > 0) {
            summariesText = summaries.map((s, idx) => `[Tóm tắt ${idx + 1} - ${s.createdAt.toISOString().slice(0, 10)}]:\n${s.summary}`).join('\n\n');
        }
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Summary Memory:', err.message);
    } })();

    // 4. Target Member Search: Truy vấn chuyên sâu ký ức liên quan đến thành viên
    //    (Nickname / ID / biệt danh thân mật cấu hình qua env MEMBER_ALIASES)
    let targetMemberText = '';
    const memberTask = (async () => { try {
        const targetGuild = guild || (client.guilds?.cache.get(guildId));
        const members = targetGuild ? targetGuild.members.cache.values() : [];
        const { userIds, keywords } = findMentionedMembers(query, members);

        if (userIds.length > 0 || keywords.length > 0) {
            const memberMsgs = await ChatMessage.find({
                guildId,
                channelId: { $in: allowedChannelIds },
                $or: [
                    { authorId: { $in: userIds } },
                    { mentions: { $in: userIds } },
                    // escapeRegex: tên có ký tự đặc biệt như ( * [ không làm hỏng truy vấn
                    ...keywords.map(kw => ({ content: { $regex: escapeRegex(kw), $options: 'i' } }))
                ]
            })
            .sort({ createdAt: -1 })
            .limit(10);

            if (memberMsgs.length > 0) {
                memberMsgs.reverse();
                targetMemberText = memberMsgs.map(m => `• [${m.username}]: ${m.content}`).join('\n');
            }
        }
    } catch (err) {
        console.warn('⚠️ Lỗi lấy Target Member Memory:', err.message);
    } })();

    // 4 nguồn ngữ cảnh độc lập -> chạy song song (embedding + Qdrant chậm nhất, ~1-2s)
    await Promise.all([recentTask, vectorTask, summaryTask, memberTask]);

    return {
        recentChatText: recentChatText || '(Không có tin nhắn gần đây)',
        vectorMemoryText: vectorMemoryText || '(Không tìm thấy ký ứng liên quan trực tiếp)',
        summariesText: summariesText || '(Chưa có tóm tắt lịch sử)',
        targetMemberText: targetMemberText || '(Không tìm thấy tin nhắn riêng liên quan đến thành viên này)'
    };
}

module.exports = {
    processIncomingMessage,
    buildSageContext,
    generateChatSummary,
    checkAndTriggerSummary,
    buildSummaryTranscript
};
