const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { generateSageResponseWithContext } = require('../../services/aiService');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const ChatMessage = require('../../shared/models/ChatMessage');
const { upsertMessageVector } = require('../../services/qdrantService');

const EMBEDDING_MIN_LENGTH = 15;

const hiengiaCommand = {
    data: new SlashCommandBuilder()
        .setName('hiengia')
        .setDescription('🔮 Thỉnh giáo hoặc trò chuyện luận đạo với Thiên Thư Hiền Giả')
        .addStringOption(option => 
            option.setName('cau_hoi')
                .setDescription('Vấn đề đạo hữu muốn thỉnh giáo Hiền Giả')
                .setRequired(true)
        ),
    async execute(interaction) {
        const question = interaction.options.getString('cau_hoi');
        const displayName = getDisplayName(interaction);

        await interaction.deferReply();

        try {
            const answer = await generateSageResponseWithContext({
                question,
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                displayName
            });

            const embed = new EmbedBuilder()
                .setColor('#7289DA')
                .setTitle(`☯️ Thiên Thư Hiền Giả Luận Đạo`)
                .addFields(
                    { name: '❓ Đạo Hữu Hỏi:', value: question },
                    { name: '🧙‍♂️ Hiền Giả Đáp:', value: answer }
                )
                .setFooter({ text: 'Thiên Thư Môn • Đạo pháp tự nhiên', iconURL: interaction.client.user.displayAvatarURL() })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('❌ Lỗi hiengia execute:', err);
            await interaction.editReply({
                content: '🧙‍♂️ Bản tôn đang nhập định bế quan diễn tính thiên cơ, tạm thời chưa thể đáp lời đạo hữu!'
            }).catch(() => {});
        }
    }
};

// Giữ thêm alias hien-gia để đảm bảo tương thích ngược
const hienGiaAliasCommand = {
    data: new SlashCommandBuilder()
        .setName('hien-gia')
        .setDescription('🔮 Thỉnh giáo hoặc trò chuyện luận đạo với Thiên Thư Hiền Giả (Alias)')
        .addStringOption(option => 
            option.setName('cau_hoi')
                .setDescription('Vấn đề đạo hữu muốn thỉnh giáo Hiền Giả')
                .setRequired(true)
        ),
    execute: hiengiaCommand.execute
};

// Lệnh đồng bộ lịch sử chat cũ dành cho Admin
const syncHistoryCommand = {
    data: new SlashCommandBuilder()
        .setName('sync-history')
        .setDescription('📜 [Admin] Đồng bộ lịch sử tin nhắn cũ vào Thiên Thư Kho & Linh Thức')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(opt =>
            opt.setName('limit_per_channel')
                .setDescription('Số lượng tin nhắn tối đa cần cào mỗi kênh (Mặc định: 1000)')
                .setRequired(false)
        ),
    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Lệnh này chỉ dùng trong Server Discord!', flags: 64 });
        }

        const maxLimit = interaction.options.getInteger('limit_per_channel') || 1000;
        await interaction.deferReply({ flags: 64 });

        let totalSaved = 0;
        let totalEmbedded = 0;

        const textChannels = interaction.guild.channels.cache.filter(c => c.isTextBased() && !c.isVoiceBased());
        await interaction.editReply(`🔄 Đang tiến hành quét lịch sử ${textChannels.size} kênh văn bản (Tối đa ${maxLimit} tin/kênh)...`);

        for (const [channelId, channel] of textChannels) {
            let lastMessageId = null;
            let channelFetched = 0;
            let hasMore = true;

            while (hasMore && channelFetched < maxLimit) {
                const options = { limit: 100 };
                if (lastMessageId) options.before = lastMessageId;

                let messages;
                try {
                    messages = await channel.messages.fetch(options);
                } catch (e) {
                    break;
                }

                if (!messages || messages.size === 0) {
                    hasMore = false;
                    break;
                }

                for (const [msgId, msg] of messages) {
                    lastMessageId = msgId;
                    channelFetched++;

                    if (msg.author.bot) continue;
                    const content = (msg.content || '').trim();
                    if (!content) continue;

                    const existing = await ChatMessage.findOne({ messageId: msgId });
                    if (existing) continue;

                    const replyTo = msg.reference?.messageId || null;
                    const attachments = msg.attachments.map(att => att.url);
                    const mentions = msg.mentions.users.map(u => u.id);
                    const shouldEmbed = content.length >= EMBEDDING_MIN_LENGTH;

                    try {
                        await ChatMessage.create({
                            guildId: interaction.guildId,
                            channelId: channel.id,
                            messageId: msgId,
                            authorId: msg.author.id,
                            username: msg.member?.displayName || msg.author.username,
                            content,
                            replyTo,
                            attachments,
                            mentions,
                            embedding: shouldEmbed,
                            createdAt: msg.createdAt
                        });
                        totalSaved++;

                        if (shouldEmbed) {
                            upsertMessageVector({
                                messageId: msgId,
                                guildId: interaction.guildId,
                                channelId: channel.id,
                                authorId: msg.author.id,
                                username: msg.member?.displayName || msg.author.username,
                                content,
                                createdAt: msg.createdAt
                            }).catch(() => {});
                            totalEmbedded++;
                        }
                    } catch (e) {
                        if (e.code !== 11000) console.warn('Lỗi lưu tin nhắn:', e.message);
                    }
                }
                await new Promise(res => setTimeout(res, 300));
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle(`✅ Hoàn Thành Đồng Bộ Lịch Sử Chat`)
            .setDescription(`Bổn Hiền Giả đã ghi chép toàn bộ linh ký lịch sử của Server vào Thiên Thư Kho!`)
            .addFields(
                { name: '📥 Tin nhắn đã lưu Tàng Kinh Môn:', value: `${totalSaved}`, inline: true },
                { name: '🧠 Tin nhắn đã đúc kết Linh Thức:', value: `${totalEmbedded}`, inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });
    }
};

module.exports = {
    commands: [hiengiaCommand, hienGiaAliasCommand, syncHistoryCommand],
    interactions: {}
};
