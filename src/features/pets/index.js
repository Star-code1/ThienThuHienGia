const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');

const PET_SHOP = [
    { id: 'fox', name: 'Linh Hồ Cửu Vĩ 🦊', price: 10000, desc: 'Hồ tiên 9 đuôi lanh lợi, tăng vận may ngộ tính.' },
    { id: 'turtle', name: 'Kim Quy Trấn Hải 🐢', price: 20000, desc: 'Thần quy ngàn năm mang lại đại phú đại quý.' },
    { id: 'bird', name: 'Băng Phượng Tuyết Sơn 🦅', price: 50000, desc: 'Băng phượng thanh cao giáng thế ban linh khí.' },
    { id: 'dragon', name: 'Chân Long Thần Thú 🐉', price: 100000, desc: 'Rồng thần đại năng đại diện cho bá khí tối cao.' },
];

const shopPetCommand = {
    data: new SlashCommandBuilder()
        .setName('shop-pet')
        .setDescription('🦊 Xem Cửa Hàng Linh Thú Đồng Hành (Pet) Thiên Thu Môn'),
    async execute(interaction) {
        let desc = PET_SHOP.map(p => 
            `• **${p.name}** — Giá: **\`${p.price.toLocaleString()}\` 💎 Linh Thạch**\n  └ *${p.desc}*`
        ).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor('#F39C12')
            .setTitle('🐾 CỬA HÀNG LINH THÚ ĐỒNG HÀNH • THIÊN THU MÔN')
            .setDescription(
                `Dùng Linh Thạch nhận nuôi Linh Thú đồng hành cùng tu luyện!\n\n` + desc + `\n\n` +
                `👉 Dùng lệnh \`/mua-pet [pet_id]\` để nhận nuôi!`
            )
            .setFooter({ text: 'Linh thú thần hộ mệnh trên con đường tu tiên' });

        await interaction.reply({ embeds: [embed] });
    }
};

const muaPetCommand = {
    data: new SlashCommandBuilder()
        .setName('mua-pet')
        .setDescription('🐾 Nhận nuôi Linh Thú đồng hành')
        .addStringOption(opt => 
            opt.setName('pet')
                .setDescription('Chọn Linh Thú muốn nhận nuôi')
                .setRequired(true)
                .addChoices(
                    { name: '🦊 Linh Hồ Cửu Vĩ (10,000 💎)', value: 'fox' },
                    { name: '🐢 Kim Quy Trấn Hải (20,000 💎)', value: 'turtle' },
                    { name: '🦅 Băng Phượng Tuyết Sơn (50,000 💎)', value: 'bird' },
                    { name: '🐉 Chân Long Thần Thú (100,000 💎)', value: 'dragon' },
                )
        ),
    async execute(interaction) {
        const petId = interaction.options.getString('pet');
        const petObj = PET_SHOP.find(p => p.id === petId);

        const profile = await UserProfile.getOrCreate(interaction.user.id, interaction.user.username);

        const hasPet = profile.pets.some(p => p.petId === petId);
        if (hasPet) {
            return interaction.reply({ content: `⚠️ Đạo hữu đã nhận nuôi **${petObj.name}** rồi!`, flags: 64 });
        }

        if (profile.linhThach < petObj.price) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Cần **\`${petObj.price.toLocaleString()}\` 💎 Linh Thạch** để nhận nuôi ${petObj.name}.`,
                flags: 64
            });
        }

        profile.linhThach -= petObj.price;
        profile.pets.push({
            petId: petObj.id,
            name: petObj.name,
            level: 1,
            exp: 0,
            lastFed: null
        });
        profile.activePetId = petObj.id;
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🎉 KHAI MỞ LINH THÚ ĐỒNG HÀNH 🎉')
            .setDescription(
                `🐾 Đạo hữu **${interaction.user.username}** đã nhận nuôi thành công **${petObj.name}**!\n\n` +
                `✨ **${petObj.name}** chính thức xuất chiến làm Linh Thú đồng hành.\n` +
                `🍖 Dùng lệnh \`/nuoi-pet\` để cho Linh Thú ăn và tăng cấp độ!`
            )
            .setFooter({ text: 'Thiên Thu Môn • Linh thú quy phục' });

        await interaction.reply({ embeds: [embed] });
    }
};

const nuoiPetCommand = {
    data: new SlashCommandBuilder()
        .setName('nuoi-pet')
        .setDescription('🍖 Cho Linh Thú đồng hành ăn Linh Dược (Tốn 100 Linh Thạch) để tăng EXP'),
    async execute(interaction) {
        const profile = await UserProfile.getOrCreate(interaction.user.id, interaction.user.username);

        if (!profile.pets.length) {
            return interaction.reply({ content: '⚠️ Đạo hữu chưa có Linh Thú nào! Dùng `/shop-pet` để nhận nuôi.', flags: 64 });
        }

        const activePet = profile.pets.find(p => p.petId === profile.activePetId) || profile.pets[0];
        const foodCost = 100;

        if (profile.linhThach < foodCost) {
            return interaction.reply({ content: `⚠️ Đạo hữu không đủ Linh Thạch để mua Linh Dược cho Pet (Cần \`${foodCost}\` 💎).`, flags: 64 });
        }

        profile.linhThach -= foodCost;
        activePet.exp += 50;

        let levelMsg = '';
        const expNeeded = activePet.level * 100;
        if (activePet.exp >= expNeeded) {
            activePet.level += 1;
            activePet.exp -= expNeeded;
            profile.addTuVi(50); // Thưởng tu vi cho chủ khi pet lên cấp
            levelMsg = `\n🎉 **CHÚC MỪNG LINH THÚ ĐÃ THĂNG LÊN CẤP [ Level ${activePet.level} ]!** Ban cho chủ nhân +50 Tu Vi!`;
        }

        activePet.lastFed = new Date();
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle('🍖 CHO LINH THÚ ĂN LINH DƯỢC')
            .setDescription(
                `🐾 Đạo hữu cho **${activePet.name}** ăn Linh Dược (-100 💎 Linh Thạch).\n\n` +
                `✨ EXP hiện tại: **\`${activePet.exp}/${activePet.level * 100}\`**\n` +
                `⭐ Cấp độ hiện tại: **Level ${activePet.level}**` + levelMsg
            )
            .setFooter({ text: 'Linh Thú càng cao cấp càng mang lại nhiều may mắn' });

        await interaction.reply({ embeds: [embed] });
    }
};

const petCommand = {
    data: new SlashCommandBuilder()
        .setName('pet')
        .setDescription('🐾 Xem danh sách và chỉ số Linh Thú đồng hành của bạn'),
    async execute(interaction) {
        const profile = await UserProfile.getOrCreate(interaction.user.id, interaction.user.username);

        if (!profile.pets.length) {
            return interaction.reply({ content: '⚠️ Đạo hữu chưa có Linh Thú nào! Dùng `/shop-pet` để nhận nuôi.', flags: 64 });
        }

        let desc = profile.pets.map(p => {
            const isActive = p.petId === profile.activePetId ? ' *(Đang xuất chiến)*' : '';
            return `• **${p.name}**${isActive}\n  └ Cấp độ: **Level ${p.level}** (EXP: \`${p.exp}/${p.level * 100}\`)`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle(`🐾 LINH THÚ ĐỒNG HÀNH • ${interaction.user.username}`)
            .setDescription(desc)
            .setFooter({ text: 'Dùng /nuoi-pet để chăm sóc Linh Thú' });

        await interaction.reply({ embeds: [embed] });
    }
};

module.exports = {
    commands: [shopPetCommand, muaPetCommand, nuoiPetCommand, petCommand],
    interactions: {}
};
