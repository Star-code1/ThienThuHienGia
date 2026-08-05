const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');

const gesturesCommand = {
    data: new SlashCommandBuilder()
        .setName('dongtac')
        .setDescription('🎭 Thực hiện động tác tương tác Tiên Hiệp với đạo hữu khác')
        .addStringOption(opt => 
            opt.setName('hanh_dong')
                .setDescription('Chọn hành động tương tác')
                .setRequired(true)
                .addChoices(
                    { name: '💆‍♂️ Xoa Đầu (Thưởng +10 Tu Vi)', value: 'xoadau' },
                    { name: '⚡ Truyền Công (Tặng 100 Linh Thạch)', value: 'truyencong' },
                    { name: '⚔️ Tỷ Võ (Giao lưu 1v1 cược 100 Linh Thạch)', value: 'tyvo' },
                    { name: '🤝 Bái Sư (Tuyên thệ bái làm sư phụ)', value: 'baisu' },
                    { name: '🌸 Tặng Hoa Nghịch Thủy Hàn (+50 Linh Thạch)', value: 'tanghoa' },
                )
        )
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('Đạo hữu bạn muốn tương tác')
                .setRequired(true)
        ),
    async execute(interaction) {
        const action = interaction.options.getString('hanh_dong');
        const targetUser = interaction.options.getUser('user');

        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ content: '⚠️ Bạn không thể tự thực hiện động tác với chính mình!', flags: 64 });
        }
        if (targetUser.bot) {
            return interaction.reply({ content: '⚠️ Bot không thể tương tác động tác tu tiên!', flags: 64 });
        }

        const senderProfile = await UserProfile.getOrCreate(interaction.user.id, interaction.user.username);
        const targetProfile = await UserProfile.getOrCreate(targetUser.id, targetUser.username);

        if (action === 'xoadau') {
            const cost = 20;
            if (senderProfile.linhThach < cost) {
                return interaction.reply({ content: `⚠️ Đạo hữu không đủ Linh Thạch! Cần \`${cost}\` 💎.`, flags: 64 });
            }

            senderProfile.linhThach -= cost;
            targetProfile.addTuVi(10);
            await senderProfile.save();
            await targetProfile.save();

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('💆‍♂️ ĐỘNG TÁC: XOA ĐẦU NGHỊCH THỦY HÀN')
                .setDescription(
                    `💆‍♂️ **${interaction.user.username}** ân cần dịu dàng xoa đầu **${targetUser.username}**!\n\n` +
                    `✨ **${targetUser.username}** cảm nhận được ấm áp, tâm trí khai sáng nhận **+10 ✨ Tu Vi**!`
                )
                .setFooter({ text: 'Thiên Thu Môn • Tình sư đệ đồng môn' });

            await interaction.reply({ embeds: [embed] });

        } else if (action === 'truyencong') {
            const amount = 100;
            if (senderProfile.linhThach < amount) {
                return interaction.reply({ content: `⚠️ Đạo hữu không đủ Linh Thạch! Cần \`${amount}\` 💎 để truyền công.`, flags: 64 });
            }

            senderProfile.linhThach -= amount;
            targetProfile.linhThach += amount;
            targetProfile.addTuVi(20);
            await senderProfile.save();
            await targetProfile.save();

            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('⚡ ĐỘNG TÁC: TRUYỀN CÔNG ĐẠO NĂNG')
                .setDescription(
                    `⚡ **${interaction.user.username}** vận công truyền nhập linh khí cho **${targetUser.username}**!\n\n` +
                    `🎁 **${targetUser.username}** nhận được **+100 💎 Linh Thạch** & **+20 ✨ Tu Vi**!`
                )
                .setFooter({ text: 'Truyền công giúp đồng môn đột phá' });

            await interaction.reply({ embeds: [embed] });

        } else if (action === 'tyvo') {
            const bet = 100;
            if (senderProfile.linhThach < bet) {
                return interaction.reply({ content: `⚠️ Bạn không đủ Linh Thạch! Cần \`${bet}\` 💎 để tỷ võ.`, flags: 64 });
            }
            if (targetProfile.linhThach < bet) {
                return interaction.reply({ content: `⚠️ **${targetUser.username}** không đủ Linh Thạch để tiếp chiêu tỷ võ!`, flags: 64 });
            }

            const senderWin = Math.random() < 0.5;
            let winnerName = senderWin ? interaction.user.username : targetUser.username;
            let loserName = senderWin ? targetUser.username : interaction.user.username;

            if (senderWin) {
                senderProfile.linhThach += bet;
                targetProfile.linhThach -= bet;
            } else {
                senderProfile.linhThach -= bet;
                targetProfile.linhThach += bet;
            }

            await senderProfile.save();
            await targetProfile.save();

            const embed = new EmbedBuilder()
                .setColor(senderWin ? '#2ECC71' : '#E74C3C')
                .setTitle('⚔️ ĐỘNG TÁC: TỶ VÕ GIAO LƯU ⚔️')
                .setDescription(
                    `⚔️ **${interaction.user.username}** và **${targetUser.username}** đã rút binh khí giao chiến 100 hiệp tại Thiên Thu Môn!\n\n` +
                    `🏆 **CHIẾN THẮNG:** Đạo hữu **${winnerName}** tuyệt kỹ xuất thần, đoạt lấy **+100 💎 Linh Thạch** từ **${loserName}**!`
                )
                .setFooter({ text: 'Tỷ võ rèn luyện thân thể • Thắng bại là chuyện thường tình' });

            await interaction.reply({ embeds: [embed] });

        } else if (action === 'baisu') {
            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('🤝 ĐỘNG TÁC: BÁI SƯ HỌC ĐẠO')
                .setDescription(
                    `🤝 **${interaction.user.username}** cung kính khấu bái trước mặt **${targetUser.username}**, nguyện theo làm đệ tử Thiên Thu Môn!\n\n` +
                    `📜 *"Sư đồ tương phùng, đạo pháp vạn năm cùng tu luyện."*`
                );

            await interaction.reply({ embeds: [embed] });

        } else if (action === 'tanghoa') {
            const cost = 50;
            if (senderProfile.linhThach < cost) {
                return interaction.reply({ content: `⚠️ Bạn không đủ Linh Thạch! Cần \`${cost}\` 💎.`, flags: 64 });
            }

            senderProfile.linhThach -= cost;
            targetProfile.linhThach += cost;
            await senderProfile.save();
            await targetProfile.save();

            const embed = new EmbedBuilder()
                .setColor('#FF69B4')
                .setTitle('🌸 ĐỘNG TÁC: TẶNG HOA NGHỊCH THỦY HÀN')
                .setDescription(
                    `🌸 **${interaction.user.username}** mỉm cười trao tặng đoá hoa tươi thắm cho **${targetUser.username}**!\n\n` +
                    `🎁 **${targetUser.username}** cảm động nhận đoá hoa kèm **+50 💎 Linh Thạch**!`
                );

            await interaction.reply({ embeds: [embed] });
        }
    }
};

module.exports = {
    commands: [gesturesCommand],
    interactions: {}
};
