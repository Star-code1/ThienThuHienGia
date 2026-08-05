const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { generateSageResponse } = require('../../services/aiService');

const hienGiaCommand = {
    data: new SlashCommandBuilder()
        .setName('hien-gia')
        .setDescription('🔮 Thỉnh giáo hoặc trò chuyện luận đạo với Thiên Thư Hiền Giả')
        .addStringOption(option => 
            option.setName('cau_hoi')
                .setDescription('Vấn đề đạo hữu muốn thỉnh giáo Hiền Giả')
                .setRequired(true)
        ),
    async execute(interaction) {
        const question = interaction.options.getString('cau_hoi');

        await interaction.deferReply();

        const answer = await generateSageResponse(question, `Người hỏi: ${interaction.user.username}`);

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
    }
};

module.exports = {
    commands: [hienGiaCommand],
    interactions: {}
};
