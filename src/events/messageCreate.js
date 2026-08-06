const { Events, EmbedBuilder } = require('discord.js');
const { processIncomingMessage } = require('../services/memoryService');
const { generateSageResponseWithContext } = require('../services/aiService');

module.exports = {
    name: Events.MessageCreate,
    once: false,
    async execute(message, client) {
        if (!message || message.author.bot) return;

        // 1. Lưu message vào MongoDB & Xử lý Rule Engine / Embedding / Summary Queue
        try {
            await processIncomingMessage(message);
        } catch (err) {
            console.error('❌ Lỗi processIncomingMessage:', err.message);
        }

        // 2. Kiểm tra nếu Bot được @mention hoặc phản hồi riêng
        if (client.user && message.mentions.has(client.user.id)) {
            // Loại bỏ tag mention khỏi câu hỏi
            const botMentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
            const cleanQuestion = message.content.replace(botMentionRegex, '').trim();

            if (!cleanQuestion) {
                await message.reply('Bổn Hiền Giả lắng nghe đây. Đạo hữu có điều gì muốn thỉnh giáo?');
                return;
            }

            try {
                await message.channel.sendTyping();

                const displayName = message.member?.displayName || message.author.username;
                const answer = await generateSageResponseWithContext({
                    question: cleanQuestion,
                    guildId: message.guild ? message.guild.id : 'DM',
                    channelId: message.channel.id,
                    displayName
                });

                const embed = new EmbedBuilder()
                    .setColor('#7289DA')
                    .setTitle(`☯️ Thiên Thư Hiền Giả Luận Đạo`)
                    .addFields(
                        { name: '❓ Đạo Hữu Hỏi:', value: cleanQuestion },
                        { name: '🧙‍♂️ Hiền Giả Đáp:', value: answer }
                    )
                    .setFooter({ text: 'Thiên Thư Môn • Đạo pháp tự nhiên', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } catch (err) {
                console.error('❌ Lỗi khi phản hồi @mention Hiền Giả:', err.message);
                await message.reply('Bổn Hiền Giả đang nhập định tu luyện, chưa kịp đáp lời đạo hữu!').catch(() => {});
            }
        }
    }
};
