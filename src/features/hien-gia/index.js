const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { generateSageResponseWithContext } = require('../../services/aiService');
const { getDisplayName } = require('../../shared/utils/nameHelper');

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

module.exports = {
    commands: [hiengiaCommand, hienGiaAliasCommand],
    interactions: {}
};
