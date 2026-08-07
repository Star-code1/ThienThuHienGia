require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const ChatMessage = require('../src/shared/models/ChatMessage');
const { upsertMessageVector } = require('../src/services/qdrantService');
const { checkAndTriggerSummary } = require('../src/services/memoryService');
const { resolveUserMentions } = require('../src/shared/utils/nameHelper');

const EMBEDDING_MIN_LENGTH = 15;
const BATCH_SIZE = 100; // API Limit Discord per request

async function syncGuildHistory(guild, maxPerChannel = 1000000) {
    console.log(`\n🚀 ===== ĐANG ĐỒNG BỘ LỊCH SỬ CHAT TỐI ƯU CHO SERVER: ${guild.name} (${guild.id}) =====`);

    const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isVoiceBased());
    console.log(`📌 Tìm thấy ${textChannels.size} kênh văn bản.`);

    let totalSaved = 0;
    let totalEmbedded = 0;

    const excludedChannels = (process.env.EXCLUDED_CHANNEL_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

    for (const [channelId, channel] of textChannels) {
        if (excludedChannels.includes(channelId)) {
            console.log(`\n🚫 Kênh #${channel.name} (${channelId}) nằm trong danh sách CẤM (EXCLUDED_CHANNEL_IDS). Bỏ qua!`);
            continue;
        }

        console.log(`\n📂 Đang quét kênh: #${channel.name} (${channelId})...`);

        let lastMessageId = null;
        let channelFetched = 0;
        let hasMore = true;

        while (hasMore && channelFetched < maxPerChannel) {
            const options = { limit: BATCH_SIZE };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            let messages;
            try {
                messages = await channel.messages.fetch(options);
            } catch (err) {
                console.warn(`⚠️ Không thể đọc lịch sử kênh #${channel.name}:`, err.message);
                break;
            }

            if (!messages || messages.size === 0) {
                hasMore = false;
                break;
            }

            const msgList = Array.from(messages.values());
            lastMessageId = msgList[msgList.length - 1].id;
            channelFetched += msgList.length;

            // 1. Tối ưu Siêu Tốc: Batch check MongoDB cho cả 100 tin nhắn trong 1 truy vấn duy nhất
            const validMsgs = msgList.filter(m => !m.author.bot && (m.content || '').trim().length > 0);
            if (validMsgs.length === 0) continue;

            const batchIds = validMsgs.map(m => m.id);
            const existingDocs = await ChatMessage.find({ messageId: { $in: batchIds } }, { messageId: 1 }).lean();
            const existingSet = new Set(existingDocs.map(d => d.messageId));

            const newDocs = [];
            const embedTasks = [];

            for (const msg of validMsgs) {
                if (existingSet.has(msg.id)) continue;

                const content = resolveUserMentions(msg, msg.content.trim());
                const replyTo = msg.reference?.messageId || null;
                const attachments = msg.attachments.map(att => att.url);
                const mentions = msg.mentions.users.map(u => u.id);
                const shouldEmbed = content.length >= EMBEDDING_MIN_LENGTH;

                newDocs.push({
                    guildId: guild.id,
                    channelId: channel.id,
                    messageId: msg.id,
                    authorId: msg.author.id,
                    username: msg.member?.displayName || msg.author.username,
                    content,
                    replyTo,
                    attachments,
                    mentions,
                    embedding: shouldEmbed,
                    createdAt: msg.createdAt
                });

                if (shouldEmbed) {
                    embedTasks.push({
                        messageId: msg.id,
                        guildId: guild.id,
                        channelId: channel.id,
                        authorId: msg.author.id,
                        username: msg.member?.displayName || msg.author.username,
                        content,
                        createdAt: msg.createdAt
                    });
                }
            }

            // 2. Batch Bulk Insert vào MongoDB
            if (newDocs.length > 0) {
                try {
                    await ChatMessage.insertMany(newDocs, { ordered: false });
                    totalSaved += newDocs.length;
                } catch (bulkErr) {
                    // Ignore duplicate key errors if any race condition
                    if (bulkErr.insertedDocs) totalSaved += bulkErr.insertedDocs.length;
                }

                // 3. Chạy bất đồng bộ sinh Embedding nền
                for (const task of embedTasks) {
                    upsertMessageVector(task).catch(() => {});
                    totalEmbedded++;
                }
            }

            console.log(`  📥 Batch ${msgList.length} tin: Nạp mới ${newDocs.length} tin (Đã quét tổng: ${channelFetched})...`);

            // Tạm dừng cực ngắn (150ms) tránh Discord API Rate limit
            await new Promise(res => setTimeout(res, 150));
        }

        // Kích hoạt sinh Summary cho các tin nhắn lịch sử vừa cào
        await checkAndTriggerSummary(guild.id, channel.id).catch(() => {});

        console.log(`✅ Hoàn thành kênh #${channel.name}: Đã cào tổng cộng ${channelFetched} tin nhắn.`);
    }

    console.log(`\n🎉 ===== HOÀN THÀNH TẤT CẢ 456K TIN NHẮN =====`);
    console.log(`📊 Tổng số tin nhắn đã lưu mới vào MongoDB: ${totalSaved}`);
    console.log(`🧠 Tổng số tin nhắn được Embedding (≥15 ký tự): ${totalEmbedded}`);
}

// Runnable Script
(async () => {
    try {
        await connectDB();
        console.log('🔐 Đang đăng nhập Discord client để cào 456k tin nhắn lịch sử...');
        await client.login(process.env.DISCORD_TOKEN);

        client.once('ready', async () => {
            console.log(`🤖 Bot đã online dưới dạng: ${client.user.tag}`);

            const guildId = process.env.GUILD_ID;
            let guild;
            if (guildId) {
                guild = await client.guilds.fetch(guildId);
            } else {
                guild = client.guilds.cache.first();
            }

            if (!guild) {
                console.error('❌ Không tìm thấy Server Discord nào. Hãy kiểm tra GUILD_ID trong file .env');
                process.exit(1);
            }

            await syncGuildHistory(guild, 1000000);
            process.exit(0);
        });
    } catch (err) {
        console.error('❌ Lỗi chạy syncHistory script:', err);
        process.exit(1);
    }
})();
