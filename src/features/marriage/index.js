const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');

// Nhẫn Đính Ước
const RINGS = [
    { id: 'nhan_dong', name: '💍 Nhẫn Đồng Tiên Duyên', price: 1000 },
    { id: 'nhan_bac', name: '💖 Nhẫn Bạc Bạch Kim', price: 5000 },
    { id: 'nhan_vang', name: '👑 Nhẫn Vàng Long Phụng', price: 20000 },
    { id: 'nhan_kim_cuong', name: '💎 Nhẫn Kim Cương Vĩnh Cửu', price: 50000 },
];

// Trạng thái các lời cầu hôn đang chờ xử lý: proposalKey -> proposalObj
const activeProposals = new Map();

// 1. Cửa hàng nhẫn (`/shop-nhan`)
const shopNhanCommand = {
    data: new SlashCommandBuilder()
        .setName('shop-nhan')
        .setDescription('💍 Xem danh sách Nhẫn Đính Ước Đạo Lữ'),
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setTitle('💍 CỬA HÀNG NHẪN ĐÍNH ƯỚC • THIÊN THƯ MÔN')
            .setDescription(
                `🧙‍♂️ **Thiên Thư Hiền Giả** chứng giám cho tiên duyên đôi lứa! Dùng Linh Thạch mua nhẫn để cầu hôn Đạo Lữ:\n\n` +
                RINGS.map(r => `• **${r.name}**: \`${r.price.toLocaleString()}\` 💎 Linh Thạch`).join('\n') +
                `\n\n👉 Dùng lệnh \`/cauhon [user] [loai_nhan]\` để thề nguyện kết thành Đạo Lữ!`
            )
            .setFooter({ text: 'Thiên Thư Môn • Tiên Duyên Vạn Năm' });

        await interaction.reply({ embeds: [embed] });
    }
};

// 2. Cầu hôn (`/cauhon`)
const cauHonCommand = {
    data: new SlashCommandBuilder()
        .setName('cauhon')
        .setDescription('💒 Cầu hôn đạo hữu khác để kết thành Đạo Lữ song tu')
        .addUserOption(opt => 
            opt.setName('user')
                .setDescription('Đạo hữu bạn muốn cầu hôn')
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('loai_nhan')
                .setDescription('Chọn loại nhẫn đính ước')
                .setRequired(true)
                .addChoices(
                    { name: '💍 Nhẫn Đồng Tiên Duyên (1,000 Linh Thạch)', value: 'nhan_dong' },
                    { name: '💖 Nhẫn Bạc Bạch Kim (5,000 Linh Thạch)', value: 'nhan_bac' },
                    { name: '👑 Nhẫn Vàng Long Phụng (20,000 Linh Thạch)', value: 'nhan_vang' },
                    { name: '💎 Nhẫn Kim Cương Vĩnh Cửu (50,000 Linh Thạch)', value: 'nhan_kim_cuong' },
                )
        ),
    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const ringId = interaction.options.getString('loai_nhan');
        const ring = RINGS.find(r => r.id === ringId);

        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ content: '⚠️ Đạo hữu không thể tự cầu hôn chính mình!', flags: 64 });
        }
        if (targetUser.bot) {
            return interaction.reply({ content: '⚠️ Không thể cầu hôn linh thú hay Bot!', flags: 64 });
        }

        const proposerName = getDisplayName(interaction);
        const targetName = getDisplayName(interaction, targetUser);

        const proposerProfile = await UserProfile.getOrCreate(interaction.user.id, proposerName);
        const targetProfile = await UserProfile.getOrCreate(targetUser.id, targetName);

        if (proposerProfile.daoLu?.partnerId) {
            return interaction.reply({ content: '⚠️ Đạo hữu đã kết thành Đạo Lữ rồi! Phải hủy duyên cũ bằng `/ly-hon` trước.', flags: 64 });
        }
        if (targetProfile.daoLu?.partnerId) {
            return interaction.reply({ content: `⚠️ Đạo hữu **${targetName}** đã có Đạo Lữ rồi!`, flags: 64 });
        }

        if (proposerProfile.linhThach < ring.price) {
            return interaction.reply({ 
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Cần **\`${ring.price.toLocaleString()}\` 💎 Linh Thạch** để mua **${ring.name}**.`, 
                flags: 64 
            });
        }

        const proposalKey = `${interaction.user.id}_${targetUser.id}`;
        activeProposals.set(proposalKey, {
            proposerId: interaction.user.id,
            proposerName: proposerName,
            targetId: targetUser.id,
            targetName: targetName,
            ring: ring
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`marry_accept:${proposalKey}`)
                .setLabel('💖 ĐỒNG Ý KẾT ĐẠO LỮ')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`marry_decline:${proposalKey}`)
                .setLabel('💔 TỪ CHỐI')
                .setStyle(ButtonStyle.Danger)
        );

        const embed = new EmbedBuilder()
            .setColor('#FF1493')
            .setTitle('💒 THỀ NGUYỆN CẦU HÔN • THIÊN THƯ MÔN')
            .setDescription(
                `🌸 Đạo hữu **${proposerName}** đã trao tặng **${ring.name}** và ngỏ lời cầu hôn **${targetName}**!\n\n` +
                `*"Lời thề trao nhẫn hồng trần,\nCùng nhau tu luyện trọn phần tiên duyên."*\n\n` +
                `👉 **<@${targetUser.id}>**, đạo hữu có đồng ý kết thành **Đạo Lữ** cùng tu luyện trọn đời?`
            )
            .setFooter({ text: 'Thời gian phản hồi: 3 phút' });

        await interaction.reply({ content: `<@${targetUser.id}>`, embeds: [embed], components: [row] });
    }
};

const handleMarryButtons = async (interaction) => {
    const customId = interaction.customId;
    const proposalKey = customId.split(':')[1];
    const proposal = activeProposals.get(proposalKey);

    if (!proposal) {
        return interaction.reply({ content: 'Lời cầu hôn này đã hết hạn hoặc không còn tồn tại.', flags: 64 });
    }

    if (interaction.user.id !== proposal.targetId) {
        return interaction.reply({ content: 'Lời cầu hôn này không dành cho đạo hữu!', flags: 64 });
    }

    if (customId.startsWith('marry_accept:')) {
        activeProposals.delete(proposalKey);

        const proposerProfile = await UserProfile.getOrCreate(proposal.proposerId, proposal.proposerName);
        const targetProfile = await UserProfile.getOrCreate(proposal.targetId, proposal.targetName);

        if (proposerProfile.linhThach < proposal.ring.price) {
            return interaction.reply({ content: '⚠️ Đạo hữu cầu hôn hiện không đủ Linh Thạch để thanh toán nhẫn đính ước!', flags: 64 });
        }

        // Trừ linh thạch người cầu hôn & Cập nhật duyên nợ
        proposerProfile.linhThach -= proposal.ring.price;

        const now = new Date();
        proposerProfile.daoLu = {
            partnerId: proposal.targetId,
            partnerName: proposal.targetName,
            ringName: proposal.ring.name,
            intimacy: 100,
            marriedAt: now
        };

        targetProfile.daoLu = {
            partnerId: proposal.proposerId,
            partnerName: proposal.proposerName,
            ringName: proposal.ring.name,
            intimacy: 100,
            marriedAt: now
        };

        await proposerProfile.save();
        await targetProfile.save();

        const embed = new EmbedBuilder()
            .setColor('#FF69B4')
            .setTitle('🎉 CHÚC MỪNG KẾT THÀNH ĐẠO LỮ 🎉')
            .setDescription(
                `💖 Đạo hữu **${proposal.proposerName}** và **${proposal.targetName}** đã chính thức trao **${proposal.ring.name}** và kết thành **ĐẠO LỮ** tại Thiên Thư Môn!\n\n` +
                `✨ Cùng nhau song tu, chung sức trong trận Bang Chiến Nghịch Thủy Hàn và tích lũy điểm Thân Thiết!\n\n` +
                `👩‍❤️‍👨 Xem thông tin Đạo Lữ qua lệnh \`/daolu\`.`
            )
            .setFooter({ text: 'Thiên Thư Môn Ban Phước Trăm Năm Hạnh Phúc' });

        await interaction.update({ embeds: [embed], components: [] });

    } else if (customId.startsWith('marry_decline:')) {
        activeProposals.delete(proposalKey);

        const embed = new EmbedBuilder()
            .setColor('#7F8C8D')
            .setTitle('💔 TỪ CHỐI CẦU HÔN')
            .setDescription(
                `Đạo hữu **${proposal.targetName}** đã dịu dàng từ chối lời cầu hôn của **${proposal.proposerName}**.\n\n` +
                `*Hồng trần chưa vương vấn, duyên chưa đến chớ gượng ép.*`
            );

        await interaction.update({ embeds: [embed], components: [] });
    }
};

const daoLuCommand = {
    data: new SlashCommandBuilder()
        .setName('daolu')
        .setDescription('👩‍❤️‍👨 Xem thông tin Đạo Lữ kết duyên của bạn'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        if (!profile.daoLu?.partnerId) {
            return interaction.reply({
                content: '⚠️ Đạo hữu hiện chưa kết thành Đạo Lữ với ai. Dùng `/shop-nhan` và `/cauhon` để tìm bạn song tu!',
                flags: 64
            });
        }

        const dateStr = new Date(profile.daoLu.marriedAt).toLocaleDateString('vi-VN');

        const embed = new EmbedBuilder()
            .setColor('#FF1493')
            .setTitle(`👩‍❤️‍👨 ĐẠO LỮ TU TIÊN • ${displayName}`)
            .addFields(
                { name: '💖 Bạn Song Tu', value: `**${profile.daoLu.partnerName}**`, inline: true },
                { name: '💍 Nhẫn Đính Ước', value: `**${profile.daoLu.ringName}**`, inline: true },
                { name: '✨ Điểm Thân Thiết', value: `\`${profile.daoLu.intimacy}\` điểm`, inline: true },
                { name: '📅 Ngày Kết Duyên', value: `\`${dateStr}\``, inline: true },
            )
            .setFooter({ text: 'Thiên Thư Môn • Tiên Duyên Vạn Năm' });

        await interaction.reply({ embeds: [embed] });
    }
};

const lyHonCommand = {
    data: new SlashCommandBuilder()
        .setName('ly-hon')
        .setDescription('💔 Hủy bỏ duyên nợ, giải trừ quan hệ Đạo Lữ'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        if (!profile.daoLu?.partnerId) {
            return interaction.reply({ content: '⚠️ Bạn chưa có Đạo Lữ nào để giải trừ duyên nợ!', flags: 64 });
        }

        const partnerId = profile.daoLu.partnerId;
        const partnerName = profile.daoLu.partnerName;

        // Reset both profiles
        profile.daoLu = { partnerId: null, partnerName: null, ringName: null, intimacy: 0, marriedAt: null };
        await profile.save();

        const partnerProfile = await UserProfile.findOne({ userId: partnerId });
        if (partnerProfile) {
            partnerProfile.daoLu = { partnerId: null, partnerName: null, ringName: null, intimacy: 0, marriedAt: null };
            await partnerProfile.save();
        }

        await interaction.reply(
            `💔 **${displayName}** và **${partnerName}** đã chính thức cắt đứt duyên nợ, trở lại con đường tu tiên độc hành.`
        );
    }
};

module.exports = {
    commands: [shopNhanCommand, cauHonCommand, daoLuCommand, lyHonCommand],
    interactions: {
        'marry_accept': handleMarryButtons,
        'marry_decline': handleMarryButtons,
    }
};
