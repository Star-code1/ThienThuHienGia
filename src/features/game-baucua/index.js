const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { generateBaucuaCommentary } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const { LINH_THU, rollDice, settleBets, totalOf } = require('./baucuaEngine');

const BET_SECONDS = 30;

// Các sòng Bầu Cua đang mở: sessionId -> gameSession (một kênh có thể mở nhiều sòng cùng lúc)
// Tiền cược được TRỪ NGAY khi đặt; khi lắc sẽ trả lại vốn + thưởng cho các cửa trúng.
const activeBaucuaGames = new Map();

const shortName = (beast) => beast.name.split(' ')[0];

function betButtons(sessionId, disabled = false) {
    const beastButton = (beast) => new ButtonBuilder()
        .setCustomId(`bc_modal:${sessionId}:${beast.id}`)
        .setLabel(`${beast.emoji} ${shortName(beast)}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled);

    return [
        new ActionRowBuilder().addComponents(LINH_THU.slice(0, 3).map(beastButton)),
        new ActionRowBuilder().addComponents(
            ...LINH_THU.slice(3, 6).map(beastButton),
            new ButtonBuilder().setCustomId('bc_rules').setLabel('📖 Luật Chơi').setStyle(ButtonStyle.Secondary)
        ),
    ];
}

/** Khoá các nút cược trên tin nhắn mở sòng (khi sòng đã lắc hoặc bị huỷ) */
async function lockSessionMessage(session) {
    if (!session.message) return;
    await session.message.edit({ components: betButtons(session.id, true) }).catch(() => {});
}

async function sendToSession(session, payload) {
    if (session.messageId) {
        payload.reply = { messageReference: session.messageId, failIfNotExists: false };
    }
    await session.channel.send(payload).catch(() => {});
}

async function settleSession(sessionId) {
    const session = activeBaucuaGames.get(sessionId);
    if (!session) return;
    activeBaucuaGames.delete(sessionId);
    lockSessionMessage(session);

    const diceResults = rollDice();
    const diceIds = diceResults.map(d => d.id);
    const diceNames = diceResults.map(d => `${d.emoji} ${shortName(d)}`);

    let totalBetsAll = 0;
    let totalNetProfitAll = 0;
    const summary = [];

    for (const [userId, userBetObj] of Object.entries(session.bets)) {
        const { totalBet, payout, net, lines } = settleBets(userBetObj.beastBets, diceIds);
        if (totalBet <= 0) continue;
        totalBetsAll += totalBet;
        totalNetProfitAll += net;

        try {
            await UserProfile.incLinhThachById(userId, payout, {
                inc: { 'stats.baucuaGames': 1, 'stats.baucuaWinLinhThach': net },
            });
        } catch (err) {
            console.error(`❌ [BauCua] Lỗi trả thưởng cho ${userId}:`, err);
        }

        const details = lines.map(({ beastId, amount, matchCount, win }) => {
            const beast = LINH_THU.find(b => b.id === beastId);
            return matchCount > 0
                ? `${beast.emoji} ${shortName(beast)}: \`${amount}\` (Thắng x${matchCount} = +${win} 💎)`
                : `${beast.emoji} ${shortName(beast)}: \`${amount}\` (Thua)`;
        });
        const netStr = net >= 0 ? `+${net.toLocaleString()} 💎` : `${net.toLocaleString()} 💎`;
        summary.push(`👤 **${userBetObj.username}**: Tổng cược \`${totalBet.toLocaleString()}\` 💎 ➔ **${netStr}**\n  └ ${details.join('\n  └ ')}`);
    }

    let aiCommentary;
    try {
        aiCommentary = await generateBaucuaCommentary(diceNames, totalBetsAll, totalNetProfitAll);
    } catch (err) {
        console.error('❌ [BauCua] Lỗi lấy lời bình:', err.message);
        aiCommentary = 'Thiên cơ khó lường, thắng thua đều là duyên số.';
    }

    const resultEmbed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('🎲 KẾT QUẢ GIEO QUẺ BẦU CUA LỤC ĐẠI LINH THÚ 🎲')
        .setDescription(
            `🏮 Sòng của **${session.hostName}**\n` +
            `🔮 **3 Đại Linh Thú giáng thế:**\n` +
            `>>> **${diceResults[0].emoji} ${diceResults[0].name}** | **${diceResults[1].emoji} ${diceResults[1].name}** | **${diceResults[2].emoji} ${diceResults[2].name}**\n\n` +
            (summary.length > 0
                ? `📊 **BẢNG KẾT QUẢ CÁC ĐẠO HỮU:**\n${summary.join('\n\n')}\n\n`
                : `⚠️ Không có đạo hữu nào tham gia đặt cược trong phiên này.\n\n`) +
            `💬 **Lời Quẻ Hiền Giả (Thiên Thư Môn):**\n*"${aiCommentary}"*`
        )
        .setFooter({ text: 'Thiên Thư Hiền Giả Ban Quẻ • Dùng /baucua để mở sòng mới' })
        .setTimestamp();

    await sendToSession(session, { embeds: [resultEmbed] });
}

/** Huỷ mọi sòng đang mở và hoàn trả toàn bộ tiền cược (gọi khi bot tắt/khởi động lại) */
async function cancelAllSessions(reason) {
    const sessions = [...activeBaucuaGames.values()];
    activeBaucuaGames.clear();

    await Promise.all(sessions.map(async (session) => {
        clearTimeout(session.timer);
        const refunded = [];
        for (const [userId, userBetObj] of Object.entries(session.bets)) {
            const total = totalOf(userBetObj.beastBets);
            if (total <= 0) continue;
            try {
                await UserProfile.incLinhThachById(userId, total);
                refunded.push(`• **${userBetObj.username}**: hoàn \`${total.toLocaleString()}\` 💎`);
            } catch (err) {
                console.error(`❌ [BauCua] Lỗi hoàn cược cho ${userId}:`, err);
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#95A5A6')
            .setTitle('🎲 SÒNG BẦU CUA ĐÃ BỊ HUỶ')
            .setDescription(
                `⚠️ ${reason}\n\n` +
                (refunded.length ? `💰 **Đã hoàn trả tiền cược:**\n${refunded.join('\n')}` : 'Chưa có ai đặt cược.')
            );
        await Promise.all([lockSessionMessage(session), sendToSession(session, { embeds: [embed] })]);
    }));
}

const baucuaCommand = {
    data: new SlashCommandBuilder()
        .setName('baucua')
        .setDescription('🎲 Khai mở sòng Bầu Cua 30s đếm ngược (Tùy chọn cược nhiều Linh Thú)'),
    async execute(interaction) {
        const sessionId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        const hostName = getDisplayName(interaction);

        const session = {
            id: sessionId,
            hostName,
            channel: interaction.channel,
            message: null,
            messageId: null,
            startTime: Date.now(),
            bets: {}, // userId -> { username, beastBets: { bau: 100, cua: 200... } }
            timer: null,
        };
        activeBaucuaGames.set(sessionId, session);

        const endsAt = Math.floor((Date.now() + BET_SECONDS * 1000) / 1000);
        const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🎲 KHAI MỞ SÒNG BẦU CUA LỤC ĐẠI LINH THÚ 🎲')
            .setDescription(
                `🧙‍♂️ **Thiên Thư Hiền Giả** làm cái, sòng do **${hostName}** khai mở tại Thiên Thư Môn!\n\n` +
                `⏱️ **Lắc xúc xắc:** <t:${endsAt}:R>\n` +
                `👉 Bấm vào nút các **Linh Thú** bên dưới để nhập số Linh Thạch cược tùy ý (Có thể cược nhiều Linh Thú cùng lúc!).\n` +
                `💎 Linh Thạch được trừ ngay khi đặt cược.`
            )
            .setFooter({ text: `Hết ${BET_SECONDS} giây Hiền Giả sẽ lắc 3 xúc xắc và trả thưởng!` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], components: betButtons(sessionId) });
        session.message = await interaction.fetchReply().catch(() => null);
        session.messageId = session.message?.id || null;

        session.timer = setTimeout(() => {
            settleSession(sessionId).catch(err => console.error('❌ [BauCua] settleSession:', err));
        }, BET_SECONDS * 1000);
    }
};

// Interaction handler cho Bầu Cua
const handleBaucuaInteractions = async (interaction) => {
    const customId = interaction.customId;

    if (customId === 'bc_rules') {
        const rulesEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('📖 LUẬT CHƠI BẦU CUA LỤC ĐẠI LINH THÚ')
            .setDescription(
                `🎲 **Quy tắc gieo quẻ:**\n` +
                `• Mỗi lượt chơi kéo dài ${BET_SECONDS} giây cho tất cả đạo hữu cùng tham gia đặt cược.\n` +
                `• Có 6 Linh Thú: Bầu 🍈, Cua 🦀, Tôm 🦞, Cá 🐟, Gà 🐓, Nai 🦌.\n` +
                `• Đạo hữu có thể chọn cược Linh Thạch vào một hoặc nhiều Linh Thú cùng lúc!\n` +
                `• Linh Thạch được trừ ngay khi đặt cược. Nếu sòng bị huỷ, tiền cược được hoàn trả.\n\n` +
                `💰 **Trả thưởng:**\n` +
                `• Nếu 3 xúc xắc ra 1 con trùng khớp ➔ Hoàn tiền cược + Thưởng x1 tiền cược.\n` +
                `• Nếu ra 2 con trùng khớp ➔ Hoàn tiền cược + Thưởng x2 tiền cược.\n` +
                `• Nếu ra 3 con trùng khớp ➔ Hoàn tiền cược + Thưởng x3 tiền cược.\n` +
                `• Nếu không trúng ➔ Mất số Linh Thạch đã cược vào linh thú đó.`
            )
            .setFooter({ text: 'Thiên Thư Hiền Giả Ban Quẻ' });

        return interaction.reply({ embeds: [rulesEmbed], flags: 64 });
    }

    const [, sessionId, beastId] = customId.split(':');
    const session = activeBaucuaGames.get(sessionId);

    if (!session) {
        return interaction.reply({ content: '⚠️ Ván Bầu Cua này đã hết giờ cược hoặc chưa khởi tạo. Dùng `/baucua` để mở sòng mới!', flags: 64 });
    }

    if (customId.startsWith('bc_modal:')) {
        const beast = LINH_THU.find(b => b.id === beastId);
        if (!beast) return;

        const modal = new ModalBuilder()
            .setCustomId(`bc_submit:${sessionId}:${beastId}`)
            .setTitle(`Đặt cược vào ${beast.emoji} ${shortName(beast)}`);

        const input = new TextInputBuilder()
            .setCustomId('bet_amount')
            .setLabel(`Số Linh Thạch cược vào ${beast.name}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Nhập số (Ví dụ: 100, 500, 2000...)')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(8);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }
};

// Modal Submit handler
const handleBaucuaModalSubmit = async (interaction) => {
    const customId = interaction.customId;
    if (!customId.startsWith('bc_submit:')) return;

    const [, sessionId, beastId] = customId.split(':');
    const session = activeBaucuaGames.get(sessionId);
    if (!session) {
        return interaction.reply({ content: `⚠️ Ván Bầu Cua đã hết ${BET_SECONDS}s đếm ngược!`, flags: 64 });
    }

    const beast = LINH_THU.find(b => b.id === beastId);
    if (!beast) return;

    const amountStr = interaction.fields.getTextInputValue('bet_amount').trim();
    const betAmount = /^\d+$/.test(amountStr) ? parseInt(amountStr, 10) : NaN;
    if (!Number.isSafeInteger(betAmount) || betAmount <= 0) {
        return interaction.reply({ content: '⚠️ Số Linh Thạch cược không hợp lệ!', flags: 64 });
    }

    const displayName = getDisplayName(interaction);
    const userId = interaction.user.id;
    const profile = await UserProfile.getOrCreate(userId, displayName);

    // Trừ tiền ngay (chỉ khi đủ) — không thể cược vượt số dư dù mở nhiều sòng hay tiêu Linh Thạch chỗ khác
    if (await profile.incLinhThach(-betAmount, { requireFunds: true }) === null) {
        return interaction.reply({
            content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach.toLocaleString()}\` 💎, cần cược: \`${betAmount.toLocaleString()}\` 💎.`,
            flags: 64
        });
    }

    // Sòng có thể đã lắc trong lúc chờ DB → hoàn lại
    if (activeBaucuaGames.get(sessionId) !== session) {
        await profile.incLinhThach(betAmount).catch(err => console.error('❌ [BauCua] Lỗi hoàn cược trễ:', err));
        return interaction.reply({ content: `⚠️ Ván Bầu Cua vừa lắc xong, đã hoàn lại \`${betAmount.toLocaleString()}\` 💎 cho đạo hữu.`, flags: 64 });
    }

    if (!session.bets[userId]) {
        session.bets[userId] = { username: displayName, beastBets: {} };
    }
    session.bets[userId].username = displayName;
    const userBetsObj = session.bets[userId].beastBets;
    userBetsObj[beastId] = (userBetsObj[beastId] || 0) + betAmount;

    await interaction.reply({
        content: `✅ **Thành công:** Đạo hữu **${displayName}** đã cược **${betAmount.toLocaleString()} Linh Thạch** vào **${beast.emoji} ${beast.name}**!\n` +
                 `💰 Tổng cược ván này của đạo hữu: \`${totalOf(userBetsObj).toLocaleString()}\` Linh Thạch · Còn lại: \`${profile.linhThach.toLocaleString()}\` 💎.`,
        flags: 64
    });
};

module.exports = {
    commands: [baucuaCommand],
    interactions: {
        'bc_modal': handleBaucuaInteractions,
        'bc_rules': handleBaucuaInteractions,
        'bc_submit': handleBaucuaModalSubmit,
    },
    onShutdown: () => cancelAllSessions('Bot đang khởi động lại để bảo trì.'),
    // Liệt kê sòng đang mở trong kênh (cho /banchoi)
    listRooms: (channelId) => [...activeBaucuaGames.values()]
        .filter(s => s.channel?.id === channelId)
        .map(s => ({
            game: '🎲 Bầu Cua',
            title: `Sòng của ${s.hostName}`,
            detail: `👥 ${Object.keys(s.bets).length} người đã cược · lắc <t:${Math.floor((s.startTime + BET_SECONDS * 1000) / 1000)}:R>`,
            joinable: true,
            url: s.message?.url,
        })),
};
