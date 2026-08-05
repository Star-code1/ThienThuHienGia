const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');

// Bảng Phẩm Giai Linh Thú (11 Cấp từ Phàm ➔ Hỗn Độn)
const RARITY_TIERS = [
    { name: 'Phàm Thú', color: '#BDC3C7', weight: 35, baseStatMin: 20, baseStatMax: 40 },
    { name: 'Linh Thú', color: '#2ECC71', weight: 25, baseStatMin: 40, baseStatMax: 70 },
    { name: 'Huyền Thú', color: '#3498DB', weight: 15, baseStatMin: 70, baseStatMax: 110 },
    { name: 'Địa Thú', color: '#9B59B6', weight: 10, baseStatMin: 110, baseStatMax: 160 },
    { name: 'Thiên Thú', color: '#F1C40F', weight: 7, baseStatMin: 160, baseStatMax: 220 },
    { name: 'Thánh Thú', color: '#E67E22', weight: 4, baseStatMin: 220, baseStatMax: 300 },
    { name: 'Tiên Thú', color: '#E74C3C', weight: 2, baseStatMin: 300, baseStatMax: 400 },
    { name: 'Thần Thú', color: '#1ABC9C', weight: 1, baseStatMin: 400, baseStatMax: 550 },
    { name: 'Cổ Thú', color: '#D35400', weight: 0.6, baseStatMin: 550, baseStatMax: 750 },
    { name: 'Hồng Hoang Thú', color: '#8E44AD', weight: 0.3, baseStatMin: 750, baseStatMax: 1000 },
    { name: 'Hỗn Độn Thú', color: '#FF0055', weight: 0.1, baseStatMin: 1000, baseStatMax: 1500 }
];

// Ngũ Hành
const ELEMENTS = [
    { name: 'Kim ⚡', boost: 'ATK' },
    { name: 'Mộc 🌿', boost: 'HP' },
    { name: 'Thủy 💧', boost: 'SPDEF' },
    { name: 'Hỏa 🔥', boost: 'SPATK' },
    { name: 'Thổ ⛰️', boost: 'DEF' }
];

// Danh sách Linh Thú theo loài
const PET_SPECIES = [
    'Hỏa Hồ Phượng Hoàng', 'Bạch Sương Băng Lang', 'U Minh Huyết Lân',
    'Thái Cực Thần Ngưu', 'Cửu Thiên Mãng Xà', 'Thương Khung Ngữ Ứng',
    'Hỗn Độn Thần Long', 'Hồng Hoang Trùng Vương', 'Kim Cang Quy Vương',
    'Linh Diệp Hươu Tiên', 'Huyền Hà Kỳ Lân', 'Cổ Yêu Thôn Thiên'
];

// Map lưu trữ tạm thời lượt chọn Keep / Swap Pet
const pendingHatchPets = new Map();

function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

function getRandomStat(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomPet() {
    const rand = Math.random() * 100;
    let cumulative = 0;
    let selectedRarity = RARITY_TIERS[0];
    let rarityIndex = 0;

    for (let i = 0; i < RARITY_TIERS.length; i++) {
        cumulative += RARITY_TIERS[i].weight;
        if (rand <= cumulative) {
            selectedRarity = RARITY_TIERS[i];
            rarityIndex = i;
            break;
        }
    }

    const elementObj = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
    const species = PET_SPECIES[Math.floor(Math.random() * PET_SPECIES.length)];

    const min = selectedRarity.baseStatMin;
    const max = selectedRarity.baseStatMax;

    return {
        name: `${selectedRarity.name} • ${species}`,
        species: species,
        rarity: selectedRarity.name,
        rarityIndex: rarityIndex,
        color: selectedRarity.color,
        element: elementObj.name,
        level: 1,
        exp: 0,
        stats: {
            hp: getRandomStat(min * 3, max * 3),
            atk: getRandomStat(min, max),
            def: getRandomStat(min, max),
            spatk: getRandomStat(min, max),
            spdef: getRandomStat(min, max)
        },
        questsCompletedToday: 0,
        lastQuestResetDate: getTodayString()
    };
}

// 1. Cửa Hàng & Mua Trứng (`/shop-trung`, `/mua-trung`)
const shopTrungCommand = {
    data: new SlashCommandBuilder()
        .setName('shop-trung')
        .setDescription('🥚 Xem Cửa Hàng Trứng Linh Thú Thiên Thư Môn (Max 5 trứng/ngày)'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);
        const today = getTodayString();

        if (profile.eggData.lastBuyDate !== today) {
            profile.eggData.eggsBoughtToday = 0;
            profile.eggData.lastBuyDate = today;
            profile.markModified('eggData');
            await profile.save();
        }

        const boughtToday = profile.eggData.eggsBoughtToday || 0;
        const remainingToday = Math.max(0, 5 - boughtToday);
        const eggCount = profile.eggData.eggCount || 0;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('pet_rules')
                .setLabel('📖 Hướng Dẫn Nuôi Pet')
                .setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setColor('#F39C12')
            .setTitle('🥚 CỬA HÀNG TRỨNG LINH THÚ • THIÊN THƯ MÔN')
            .setDescription(
                `🧙‍♂️ **Thiên Thư Hiền Giả** cung cấp Trứng Linh Thú chứa đựng cơ duyên nở ra Linh Thú huyền thoại!\n\n` +
                `💰 **Giá Trứng Linh Thú:** \`5,000\` 💎 Linh Thạch / Trứng\n` +
                `📊 **Giới hạn mua:** Tối đa **5 trứng / ngày**\n\n` +
                `📈 **Trạng thái đạo hữu (${displayName}):**\n` +
                `• Số trứng đã mua hôm nay: **\`${boughtToday}/5\`** (Còn mua được: **\`${remainingToday}\`** trứng)\n` +
                `• Số trứng đang có trong túi: **\`${eggCount}\`** trứng 🥚\n\n` +
                `👉 Dùng lệnh \`/mua-trung [soluong]\` để mua trứng!\n` +
                `👉 Dùng lệnh \`/ap-trung\` để ấp trứng nở ra Linh Thú đồng hành!`
            )
            .setFooter({ text: 'Slot Pet tối đa: 1 • Được chọn Giữ hoặc Đổi khi ấp trứng mới' });

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};

const muaTrungCommand = {
    data: new SlashCommandBuilder()
        .setName('mua-trung')
        .setDescription('🛒 Mua Trứng Linh Thú (Giá 5,000 Linh Thạch/trứng, max 5 trứng/ngày)')
        .addIntegerOption(opt =>
            opt.setName('soluong')
                .setDescription('Số lượng trứng muốn mua (1 - 5)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(5)
        ),
    async execute(interaction) {
        const amount = interaction.options.getInteger('soluong') || 1;
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);
        const today = getTodayString();

        if (profile.eggData.lastBuyDate !== today) {
            profile.eggData.eggsBoughtToday = 0;
            profile.eggData.lastBuyDate = today;
        }

        const boughtToday = profile.eggData.eggsBoughtToday || 0;
        if (boughtToday + amount > 5) {
            const canBuy = Math.max(0, 5 - boughtToday);
            return interaction.reply({
                content: `⚠️ Đạo hữu đã mua **${boughtToday}/5** trứng hôm nay! Hôm nay chỉ còn mua được thêm **${canBuy}** trứng nữa.`,
                flags: 64
            });
        }

        const pricePerEgg = 5000;
        const totalPrice = pricePerEgg * amount;

        if (profile.linhThach < totalPrice) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Mua \`${amount}\` trứng cần **\`${totalPrice.toLocaleString()}\` 💎 Linh Thạch** (Hiện có: \`${profile.linhThach.toLocaleString()}\` 💎).`,
                flags: 64
            });
        }

        profile.linhThach -= totalPrice;
        profile.eggData.eggsBoughtToday += amount;
        profile.eggData.eggCount = (profile.eggData.eggCount || 0) + amount;
        profile.markModified('eggData');
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🎉 MUA TRỨNG LINH THÚ THÀNH CÔNG 🎉')
            .setDescription(
                `🥚 Đạo hữu **${displayName}** đã mua thành công **${amount} Trứng Linh Thú** (-${totalPrice.toLocaleString()} 💎 Linh Thạch)!\n\n` +
                `📦 Túi trứng hiện có: **\`${profile.eggData.eggCount}\`** 🥚 Trứng Linh Thú\n` +
                `📊 Đã mua hôm nay: **\`${profile.eggData.eggsBoughtToday}/5\`** trứng\n\n` +
                `👉 Dùng lệnh \`/ap-trung\` ngay để ấp trứng nở ra Linh Thú!`
            )
            .setFooter({ text: 'Thiên Thư Môn • Cơ duyên linh thú' });

        await interaction.reply({ embeds: [embed] });
    }
};

// 2. Ấp Trứng (`/ap-trung`)
const apTrungCommand = {
    data: new SlashCommandBuilder()
        .setName('ap-trung')
        .setDescription('🐣 Ấp 1 Trứng Linh Thú trong túi để nở ra Linh Thú mới'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        const currentEggs = profile.eggData ? profile.eggData.eggCount : 0;

        if (!currentEggs || currentEggs <= 0) {
            return interaction.reply({
                content: '⚠️ Đạo hữu chưa có Trứng Linh Thú nào! Dùng `/shop-trung` hoặc `/mua-trung` để mua trứng.',
                flags: 64
            });
        }

        // Tiêu tốn 1 trứng
        profile.eggData.eggCount = currentEggs - 1;
        profile.markModified('eggData');
        await profile.save();

        // Sinh Pet ngẫu nhiên
        const newPet = generateRandomPet();
        const existingPet = profile.pet && profile.pet.name ? profile.pet : null;

        if (!existingPet) {
            // Chưa có pet ➔ Tự động nhận pet mới
            profile.pet = newPet;
            profile.markModified('pet');
            await profile.save();

            const embed = new EmbedBuilder()
                .setColor(newPet.color)
                .setTitle('🐣 TRỨNG NỞ! CHÚC MỪNG LINH THÚ GIÁNG THẾ 🐣')
                .setDescription(
                    `🎉 Trứng Linh Thú của **${displayName}** đã nở ra một **${newPet.name}**!\n\n` +
                    `✨ **THÔNG TIN LINH THÚ ĐỒNG HÀNH:**\n` +
                    `• Phẩm Giai: **${newPet.rarity}**\n` +
                    `• Hệ Ngũ Hành: **${newPet.element}**\n` +
                    `• Cấp Độ: **Level ${newPet.level}**\n\n` +
                    `📊 **CHỈ SỐ CHIẾN ĐẤU:**\n` +
                    `❤️ HP: **\`${newPet.stats.hp}\`** | ⚔️ ATK: **\`${newPet.stats.atk}\`** | 🛡️ DEF: **\`${newPet.stats.def}\`**\n` +
                    `🔮 SP.ATK: **\`${newPet.stats.spatk}\`** | 🔰 SP.DEF: **\`${newPet.stats.spdef}\`**\n\n` +
                    `📦 Còn lại: **\`${profile.eggData.eggCount}\`** 🥚 trứng trong túi.\n` +
                    `🍖 Dùng lệnh \`/nuoi-pet\` để nuôi dưỡng hoặc \`/nhiemvu-pet\` để làm nhiệm vụ!`
                )
                .setFooter({ text: 'Slot Pet: 1/1 • Đã tự động nhận nuôi' });

            return interaction.reply({ embeds: [embed] });
        }

        // ĐÃ CÓ PET ➔ Lưu vào pending để chọn Giữ hay Đổi!
        pendingHatchPets.set(interaction.user.id, newPet);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pet_keep:${interaction.user.id}`)
                .setLabel('🟢 Giữ Pet Cũ')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`pet_swap:${interaction.user.id}`)
                .setLabel('🔄 Đổi Nhận Pet Mới')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('pet_rules')
                .setLabel('📖 Luật Chơi')
                .setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🐣 TRỨNG ĐÃ NỞ! CHỌN GIỮ HOẶC ĐỔI PET 🐣')
            .setDescription(
                `Đạo hữu **${displayName}** vừa ấp nở ra **${newPet.name}**! (Còn lại: \`${profile.eggData.eggCount}\` 🥚 trứng)\n` +
                `⚠️ Do slot Pet tối đa chỉ là **1**, hãy so sánh chỉ số và chọn **Giữ Pet Cũ** hoặc **Đổi Pet Mới**:\n\n` +
                `🛡️ **[PET HIỆN TẠI]** ${existingPet.name}\n` +
                `• Phẩm Giai: **${existingPet.rarity}** | Hệ: **${existingPet.element}** | Cấp: **Lv.${existingPet.level}**\n` +
                `• HP: \`${existingPet.stats.hp}\` | ATK: \`${existingPet.stats.atk}\` | DEF: \`${existingPet.stats.def}\` | SPATK: \`${existingPet.stats.spatk}\` | SPDEF: \`${existingPet.stats.spdef}\`\n\n` +
                `✨ **[PET MỚI NỞ]** ${newPet.name}\n` +
                `• Phẩm Giai: **${newPet.rarity}** | Hệ: **${newPet.element}** | Cấp: **Lv.1**\n` +
                `• HP: \`${newPet.stats.hp}\` | ATK: \`${newPet.stats.atk}\` | DEF: \`${newPet.stats.def}\` | SPATK: \`${newPet.stats.spatk}\` | SPDEF: \`${newPet.stats.spdef}\``
            )
            .setFooter({ text: 'Bấm nút bên dưới để xác nhận giữ hay đổi pet!' });

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};

// Handle Nút Giữ / Đổi Pet
const handlePetSwapButtons = async (interaction) => {
    const customId = interaction.customId;
    const userId = interaction.user.id;

    if (customId === 'pet_rules') {
        const rulesEmbed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('📖 HƯỚNG DẪN HỆ THỐNG LINH THÚ (PET)')
            .setDescription(
                `🐾 **Cơ Chế Ấp Trứng & Nuôi Thú:**\n` +
                `• **Mua Trứng:** Giá 5,000 Linh Thạch, tối đa mua 5 trứng/ngày.\n` +
                `• **Ấp Trứng:** Mở trứng nhận ngẫu nhiên Linh Thú với 11 Phẩm Giai (Phàm ➔ Linh ➔ Huyền ➔ Địa ➔ Thiên ➔ Thánh ➔ Tiên ➔ Thần ➔ Cổ ➔ Hồng Hoang ➔ Hỗn Độn) & 5 Hệ Ngũ Hành (Kim, Mộc, Thủy, Hỏa, Thổ).\n` +
                `• **Slot Pet = 1:** Đạo hữu chỉ giữ 1 Linh Thú duy nhất. Khi ấp trứng mới có thể so sánh chỉ số để Giữ Pet Cũ hoặc Đổi sang Pet Mới.\n` +
                `• **Nuôi Thú (\`/nuoi-pet\`):** Cho ăn Linh Dược (-200 Linh Thạch) để tăng EXP & chỉ số khi lên cấp.\n` +
                `• **Nhiệm Vụ Pet (\`/nhiemvu-pet\`):** Làm 3 nhiệm vụ huấn luyện mỗi ngày để kiếm EXP & Linh Thạch!`
            )
            .setFooter({ text: 'Thiên Thư Môn • Linh Thú Đồng Hành' });

        return interaction.reply({ embeds: [rulesEmbed], flags: 64 });
    }

    const targetUserId = customId.split(':')[1];
    if (targetUserId !== userId) {
        return interaction.reply({ content: 'Đây không phải lượt ấp trứng của đạo hữu!', flags: 64 });
    }

    const newPet = pendingHatchPets.get(userId);
    if (!newPet) {
        return interaction.reply({ content: 'Lượt chọn Pet này đã hết hạn hoặc không tồn tại.', flags: 64 });
    }

    const displayName = getDisplayName(interaction);
    const profile = await UserProfile.getOrCreate(userId, displayName);

    if (customId.startsWith('pet_keep:')) {
        pendingHatchPets.delete(userId);
        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🟢 ĐÃ GIỮ LINH THÚ CŨ')
            .setDescription(
                `Đạo hữu **${displayName}** đã quyết định **Giữ lại ${profile.pet.name}**!\n` +
                `Linh Thú mới nở (${newPet.name}) đã được phóng sinh về tự nhiên.`
            );

        return interaction.update({ embeds: [embed], components: [] });
    }

    if (customId.startsWith('pet_swap:')) {
        pendingHatchPets.delete(userId);
        const oldName = profile.pet.name;
        profile.pet = newPet;
        profile.markModified('pet');
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('🔄 ĐÃ ĐỔI SANG LINH THÚ MỚI!')
            .setDescription(
                `Đạo hữu **${displayName}** đã chia tay **${oldName}** và nhận nuôi thành công **${newPet.name}**!\n\n` +
                `✨ Phẩm Giai: **${newPet.rarity}** | Hệ: **${newPet.element}**\n` +
                `❤️ HP: \`${newPet.stats.hp}\` | ATK: \`${newPet.stats.atk}\` | DEF: \`${newPet.stats.def}\` | 🔮 SPATK: \`${newPet.stats.spatk}\` | 🔰 SPDEF: \`${newPet.stats.spdef}\``
            );

        return interaction.update({ embeds: [embed], components: [] });
    }
};

// 3. Xem Linh Thú (`/pet`, `/linh-thu`)
const viewPetCommand = {
    data: new SlashCommandBuilder()
        .setName('pet')
        .setDescription('🐾 Xem thông tin và chỉ số Linh Thú đồng hành của bạn'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        if (!profile.pet || !profile.pet.name) {
            return interaction.reply({
                content: '⚠️ Đạo hữu chưa có Linh Thú nào! Dùng `/shop-trung` mua trứng và `/ap-trung` để ấp nở Linh Thú.',
                flags: 64
            });
        }

        const p = profile.pet;
        const expNeeded = p.level * 150;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('pet_rules')
                .setLabel('📖 Hướng Dẫn Nuôi Pet')
                .setStyle(ButtonStyle.Secondary)
        );

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle(`🐾 LINH THÚ ĐỒNG HÀNH • ${displayName}`)
            .setDescription(
                `✨ **${p.name}**\n` +
                `• Phẩm Giai: **${p.rarity}**\n` +
                `• Hệ Ngũ Hành: **${p.element}**\n` +
                `• Cấp Độ: **Level ${p.level}** (EXP: \`${p.exp}/${expNeeded}\`)\n\n` +
                `📊 **BỘ CHỈ SỐ CHIẾN ĐẤU:**\n` +
                `❤️ HP: **\`${p.stats.hp}\`**\n` +
                `⚔️ ATK (Tấn công): **\`${p.stats.atk}\`**\n` +
                `🛡️ DEF (Phòng thủ): **\`${p.stats.def}\`**\n` +
                `🔮 SP.ATK (Pháp công): **\`${p.stats.spatk}\`**\n` +
                `🔰 SP.DEF (Pháp phòng): **\`${p.stats.spdef}\`**`
            )
            .setFooter({ text: 'Dùng /nuoi-pet để cho ăn hoặc /nhiemvu-pet để làm nhiệm vụ' });

        await interaction.reply({ embeds: [embed], components: [row] });
    }
};

// 4. Nuôi Linh Thú (`/nuoi-pet`)
const nuoiPetCommand = {
    data: new SlashCommandBuilder()
        .setName('nuoi-pet')
        .setDescription('🍖 Cho Linh Thú ăn Linh Dược (Tốn 200 Linh Thạch) để tăng EXP & Chỉ số'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        if (!profile.pet || !profile.pet.name) {
            return interaction.reply({
                content: '⚠️ Đạo hữu chưa có Linh Thú! Dùng `/shop-trung` và `/ap-trung` để ấp trứng nhận Linh Thú.',
                flags: 64
            });
        }

        const cost = 200;
        if (profile.linhThach < cost) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Cho Linh Thú ăn cần \`${cost}\` 💎 Linh Thạch.`,
                flags: 64
            });
        }

        profile.linhThach -= cost;
        const p = profile.pet;
        p.exp += 75;

        let levelUpMsg = '';
        const expNeeded = p.level * 150;
        if (p.exp >= expNeeded) {
            p.level += 1;
            p.exp -= expNeeded;

            // Tăng chỉ số khi lên cấp
            p.stats.hp = Math.floor(p.stats.hp * 1.08);
            p.stats.atk = Math.floor(p.stats.atk * 1.08);
            p.stats.def = Math.floor(p.stats.def * 1.08);
            p.stats.spatk = Math.floor(p.stats.spatk * 1.08);
            p.stats.spdef = Math.floor(p.stats.spdef * 1.08);

            profile.addTuVi(60);
            levelUpMsg = `\n🎉 **CHÚC MỪNG LINH THÚ THĂNG LÊN [ LEVEL ${p.level} ]!**\n✨ Tất cả chỉ số chiến đấu tăng +8%! Ban cho chủ nhân +60 Tu Vi!`;
        }

        profile.markModified('pet');
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle('🍖 CHO LINH THÚ ĂN LINH DƯỢC')
            .setDescription(
                `🐾 Đạo hữu **${displayName}** cho **${p.name}** thưởng thức Linh Dược (-200 💎 Linh Thạch).\n\n` +
                `⭐ Cấp độ hiện tại: **Level ${p.level}** (EXP: \`${p.exp}/${p.level * 150}\`)` + levelUpMsg
            )
            .setFooter({ text: 'Linh Thú cấp càng cao chỉ số càng vượt trội' });

        await interaction.reply({ embeds: [embed] });
    }
};

// 5. Nhiệm Vụ Linh Thú (`/nhiemvu-pet`)
const nhiemvuPetCommand = {
    data: new SlashCommandBuilder()
        .setName('nhiemvu-pet')
        .setDescription('📜 Thực hiện nhiệm vụ huấn luyện Linh Thú hàng ngày (Max 3 nhiệm vụ/ngày)'),
    async execute(interaction) {
        const displayName = getDisplayName(interaction);
        const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);

        if (!profile.pet || !profile.pet.name) {
            return interaction.reply({
                content: '⚠️ Đạo hữu chưa có Linh Thú! Hãy ấp trứng nhận Linh Thú trước khi làm nhiệm vụ.',
                flags: 64
            });
        }

        const today = getTodayString();
        const p = profile.pet;

        if (p.lastQuestResetDate !== today) {
            p.questsCompletedToday = 0;
            p.lastQuestResetDate = today;
        }

        if (p.questsCompletedToday >= 3) {
            return interaction.reply({
                content: '⚠️ Linh Thú của đạo hữu đã hoàn thành đủ **3/3 nhiệm vụ hôm nay**! Hãy quay lại vào ngày mai.',
                flags: 64
            });
        }

        const quests = [
            { name: '👹 Tru Ma Tiệt Yêu', exp: 100, rewardlt: 200, desc: 'Đưa Linh Thú trừ ma vệ đạo tại Yêu Phong Sơn.' },
            { name: '💎 Tầm Bảo Linh Thạch', exp: 150, rewardlt: 300, desc: 'Linh Thú dẫn đường phát hiện mỏ Linh Thạch cổ xưa.' },
            { name: '🧘‍♂️ Luyện Khí Tẩy Tủy', exp: 200, rewardlt: 500, desc: 'Cùng Linh Thú bế quan hấp thu nguyệt hoa thiên địa.' },
        ];

        const questIndex = p.questsCompletedToday;
        const currentQuest = quests[questIndex];

        p.questsCompletedToday += 1;
        p.exp += currentQuest.exp;
        profile.linhThach += currentQuest.rewardlt;

        let levelUpMsg = '';
        const expNeeded = p.level * 150;
        if (p.exp >= expNeeded) {
            p.level += 1;
            p.exp -= expNeeded;
            p.stats.hp = Math.floor(p.stats.hp * 1.08);
            p.stats.atk = Math.floor(p.stats.atk * 1.08);
            p.stats.def = Math.floor(p.stats.def * 1.08);
            p.stats.spatk = Math.floor(p.stats.spatk * 1.08);
            p.stats.spdef = Math.floor(p.stats.spdef * 1.08);
            profile.addTuVi(60);
            levelUpMsg = `\n🎉 **LINH THÚ ĐÃ THĂNG CẤP [ LEVEL ${p.level} ]!** Ban cho chủ nhân +60 Tu Vi!`;
        }

        profile.markModified('pet');
        await profile.save();

        const embed = new EmbedBuilder()
            .setColor('#1ABC9C')
            .setTitle(`📜 NHIỆM VỤ PET (${p.questsCompletedToday}/3): ${currentQuest.name}`)
            .setDescription(
                `🐾 Linh Thú của **${displayName}** (${p.name}) đã hoàn thành nhiệm vụ: *${currentQuest.desc}*\n\n` +
                `🎁 **PHẦN THƯỞNG:**\n` +
                `• EXP Linh Thú: **+${currentQuest.exp} EXP** (Hiện có: \`${p.exp}/${p.level * 150}\`)\n` +
                `• Linh Thạch thưởng: **+${currentQuest.rewardlt} 💎 Linh Thạch**` + levelUpMsg
            )
            .setFooter({ text: `Đã hoàn thành ${p.questsCompletedToday}/3 nhiệm vụ hôm nay` });

        await interaction.reply({ embeds: [embed] });
    }
};

module.exports = {
    commands: [shopTrungCommand, muaTrungCommand, apTrungCommand, viewPetCommand, nuoiPetCommand, nhiemvuPetCommand],
    interactions: {
        'pet_keep': handlePetSwapButtons,
        'pet_swap': handlePetSwapButtons,
        'pet_rules': handlePetSwapButtons,
    }
};
