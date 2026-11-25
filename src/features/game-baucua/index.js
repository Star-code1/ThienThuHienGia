const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
} = require('discord.js');
const { generateBaucuaCommentary } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const escrow = require('../../services/escrowService');
const shutdown = require('../../shared/shutdownState');
const { LINH_THU, rollDice, settleBets, totalOf } = require('./baucuaEngine');

// Sòng Bầu Cua chạy theo 3 bước do chủ sòng điều khiển bằng nút:
//   1. 'betting'  – mọi người đặt cược (tiền trừ ngay)
//   2. 'shaken'   – chủ sòng bấm "Lắc": đóng cược, 3 xúc xắc đã lắc xong nhưng còn úp trong bát
//   3. 'done'     – chủ sòng bấm "Khui": mở bát, trả thưởng
// Có hai "bảo hiểm" để tiền không treo vĩnh viễn nếu chủ sòng bỏ đi: quá hạn đặt cược mà chưa lắc
// thì huỷ sòng và hoàn tiền; đã lắc mà quá hạn chưa khui thì tự khui.
const BET_IDLE_MS = 10 * 60 * 1000;
const SHAKEN_IDLE_MS = 5 * 60 * 1000;

// Các sòng đang mở: sessionId -> session (một kênh có thể mở nhiều sòng cùng lúc)
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
            new ButtonBuilder().setCustomId('bc_rules').setLabel('📖 Luật').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`bc_shake:${sessionId}`).setLabel('🎲 Lắc').setStyle(ButtonStyle.Success).setDisabled(disabled),
        ),
    ];
}

function openButtons(sessionId, disabled = false) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bc_open:${sessionId}`).setLabel('🔓 Khui').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    )];
}

/** Đạo hữu được điều khiển sòng: chủ sòng hoặc người có quyền Quản lý tin nhắn */
function canControl(session, interaction) {
    return interaction.user.id === session.hostId ||
        Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages));
}

async function editSessionMessage(session, payload) {
    if (!session.message) return;
    await session.message.edit(payload).catch(() => {});
}

async function sendToSession(session, payload) {
    if (session.messageId) {
        payload.reply = { messageReference: session.messageId, failIfNotExists: false };
    }
    return session.channel.send(payload).catch(() => null);
}

function againButtons(sessionId, disabled = false) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bc_again:${sessionId}`).setLabel('🔁 Ván mới').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    )];
}

// Kết quả đã được bấm "Ván mới" (mỗi bảng kết quả chỉ mở được một sòng mới)
const againUsed = new Set();

function betsLine(session) {
    const players = Object.keys(session.bets).length;
    const pot = Object.values(session.bets).reduce((s, b) => s + totalOf(b.beastBets), 0);
    return { players, pot };
}

function scheduleIdle(session, ms, fn) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
        fn().catch((err) => console.error('❌ [BauCua] timer:', err));
    }, ms);
}

/** Bước 2: chủ sòng lắc — đóng cược, xúc xắc đã có kết quả nhưng chưa lộ. Trả về false nếu không lắc được. */
async function shakeSession(sessionId) {
    const session = activeBaucuaGames.get(sessionId);
    if (!session || session.phase !== 'betting') return false;
    session.phase = 'shaken';
    session.closed = true; // từ giây này không nhận thêm cược nào nữa
    session.dice = rollDice();

    const { players, pot } = betsLine(session);
    const embed = new EmbedBuilder()
        .setColor('#8E44AD')
        .setTitle('🥣 HIỀN GIẢ ĐÃ LẮC — BÁT ĐANG ÚP 🥣')
        .setDescription(
            `🏮 Sòng của **${session.hostName}**\n\n` +
            `🎲 Ba viên xúc xắc đã lắc xong, đang úp kín dưới bát:\n>>> **❓ ❓ ❓**\n\n` +
            `🚫 **Đã đóng cược.**\n` +
            `👥 ${players} đạo hữu cược · 💎 tổng \`${pot.toLocaleString()}\` Linh Thạch\n\n` +
            `👉 **${session.hostName}** bấm nút **🔓 Khui** để mở bát và trả thưởng!`
        )
        .setFooter({ text: 'Chỉ chủ sòng (hoặc người có quyền Quản lý tin nhắn) mới khui được bát' })
        .setTimestamp();
    await editSessionMessage(session, { embeds: [embed], components: openButtons(sessionId) });

    scheduleIdle(session, SHAKEN_IDLE_MS, () => revealSession(sessionId));
    return true;
}

/** Bước 3: khui bát — công bố kết quả và trả thưởng */
async function revealSession(sessionId) {
    const session = activeBaucuaGames.get(sessionId);
    if (!session || session.phase !== 'shaken') return false;
    session.phase = 'done';
    clearTimeout(session.timer);
    activeBaucuaGames.delete(sessionId);
    editSessionMessage(session, { components: openButtons(sessionId, true) });

    const diceResults = session.dice;
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
            await escrow.payout(userId, 'baucua', sessionId, {
                credit: payout,
                discharge: totalBet,
                inc: { 'stats.baucuaGames': 1, 'stats.baucuaWinLinhThach': net },
                closes: true,
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

    await sendToSession(session, { embeds: [resultEmbed], components: againButtons(sessionId) });
    return true;
}

/** Huỷ một sòng CHƯA lắc và hoàn trả toàn bộ tiền cược */
async function cancelSession(session, reason) {
    if (session.phase !== 'betting') return;
    session.phase = 'cancelled';
    session.closed = true;
    clearTimeout(session.timer);
    activeBaucuaGames.delete(session.id);

    const refunded = [];
    for (const [userId, userBetObj] of Object.entries(session.bets)) {
        const total = totalOf(userBetObj.beastBets);
        if (total <= 0) continue;
        try {
            await escrow.payout(userId, 'baucua', session.id, { credit: total, discharge: total, closes: true });
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
    await Promise.all([
        editSessionMessage(session, { components: betButtons(session.id, true) }),
        sendToSession(session, { embeds: [embed] }),
    ]);
}

/** Mở một sòng mới; `send(payload)` gửi tin nhắn mở sòng và trả về Message (hoặc null) */
async function openSession({ channel, hostId, hostName, send }) {
    const sessionId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const session = {
        id: sessionId,
        hostId,
        hostName,
        channel,
        message: null,
        messageId: null,
        startTime: Date.now(),
        phase: 'betting',
        closed: false,
        dice: null,
        bets: {}, // userId -> { username, beastBets: { bau: 100, cua: 200... } }
        timer: null,
    };
    activeBaucuaGames.set(sessionId, session);

    const embed = new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('🎲 KHAI MỞ SÒNG BẦU CUA LỤC ĐẠI LINH THÚ 🎲')
        .setDescription(
            `🧙‍♂️ **Thiên Thư Hiền Giả** làm cái, sòng do **${hostName}** khai mở tại Thiên Thư Môn!

` +
            `👉 Bấm vào nút các **Linh Thú** bên dưới để nhập số Linh Thạch cược (có thể cược nhiều Linh Thú cùng lúc!).
` +
            `💎 Linh Thạch được trừ ngay khi đặt cược.

` +
            `🎲 Khi mọi người đã cược xong, **${hostName}** bấm **Lắc** (đóng cược) rồi bấm **Khui** để mở bát và trả thưởng.`
        )
        .setFooter({ text: 'Chủ sòng bấm 🎲 Lắc để đóng cược • Sau đó 🔓 Khui để xem kết quả' })
        .setTimestamp();

    session.message = await send({ embeds: [embed], components: betButtons(sessionId) });
    session.messageId = session.message?.id || null;

    scheduleIdle(session, BET_IDLE_MS, () =>
        cancelSession(session, 'Chủ sòng không lắc sau 10 phút nên sòng được đóng lại.'));
    return session;
}

const baucuaCommand = {
    data: new SlashCommandBuilder()
        .setName('baucua')
        .setDescription('🎲 Khai mở sòng Bầu Cua — chủ sòng bấm nút Lắc rồi Khui'),
    async execute(interaction) {
        if (shutdown.isDraining()) return interaction.reply({ content: shutdown.MAINTENANCE_TEXT, flags: 64 });
        await openSession({
            channel: interaction.channel,
            hostId: interaction.user.id,
            hostName: getDisplayName(interaction),
            send: async (payload) => {
                await interaction.reply(payload);
                return interaction.fetchReply().catch(() => null);
            },
        });
    }
};

const RULES_TEXT =
    `🎲 **Quy tắc gieo quẻ:**\n` +
    `• Chủ sòng mở sòng, mọi đạo hữu đặt cược bằng các nút Linh Thú.\n` +
    `• Chủ sòng bấm **🎲 Lắc** → đóng cược ngay, xúc xắc được lắc và úp kín. Bấm **🔓 Khui** → mở bát, trả thưởng.\n` +
    `• Có 6 Linh Thú: Bầu 🍈, Cua 🦀, Tôm 🦞, Cá 🐟, Gà 🐓, Nai 🦌.\n` +
    `• Có thể cược nhiều Linh Thú cùng lúc. Linh Thạch được trừ ngay khi cược; sòng bị huỷ trước khi lắc sẽ hoàn tiền.\n` +
    `• Chủ sòng bỏ đi: quá 10 phút chưa lắc → huỷ và hoàn tiền; đã lắc mà 5 phút chưa khui → bát tự mở.\n\n` +
    `💰 **Trả thưởng:**\n` +
    `• Ra 1 con trùng ➔ hoàn vốn + thưởng x1 tiền cược.\n` +
    `• Ra 2 con trùng ➔ hoàn vốn + thưởng x2.\n` +
    `• Ra 3 con trùng ➔ hoàn vốn + thưởng x3.\n` +
    `• Không trúng ➔ mất số Linh Thạch đã cược vào linh thú đó.`;

// Interaction handler cho Bầu Cua
const handleBaucuaInteractions = async (interaction) => {
    const customId = interaction.customId;

    if (customId === 'bc_rules') {
        const rulesEmbed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('📖 LUẬT CHƠI BẦU CUA LỤC ĐẠI LINH THÚ')
            .setDescription(RULES_TEXT)
            .setFooter({ text: 'Thiên Thư Hiền Giả Ban Quẻ' });
        return interaction.reply({ embeds: [rulesEmbed], flags: 64 });
    }

    const [, sessionId, beastId] = customId.split(':');
    const session = activeBaucuaGames.get(sessionId);

    if (customId.startsWith('bc_again:')) {
        if (shutdown.isDraining()) return interaction.reply({ content: shutdown.MAINTENANCE_TEXT, flags: 64 });
        if (againUsed.has(sessionId)) return interaction.reply({ content: '⚠️ Ván mới từ bảng kết quả này đã được mở rồi.', flags: 64 });
        againUsed.add(sessionId);
        if (againUsed.size > 500) againUsed.delete(againUsed.values().next().value);
        await interaction.update({ components: againButtons(sessionId, true) }).catch(() => {});
        await openSession({
            channel: interaction.channel,
            hostId: interaction.user.id,
            hostName: getDisplayName(interaction),
            send: (payload) => interaction.channel.send(payload).catch(() => null),
        });
        return;
    }

    if (customId.startsWith('bc_shake:') || customId.startsWith('bc_open:')) {
        const isShake = customId.startsWith('bc_shake:');
        if (!session) return interaction.reply({ content: '⚠️ Sòng này đã kết thúc. Dùng `/baucua` để mở sòng mới!', flags: 64 });
        if (!canControl(session, interaction)) {
            return interaction.reply({ content: `⚠️ Chỉ chủ sòng **${session.hostName}** (hoặc người có quyền Quản lý tin nhắn) mới ${isShake ? 'lắc' : 'khui'} được.`, flags: 64 });
        }
        if (isShake) {
            if (session.phase !== 'betting') return interaction.reply({ content: '⚠️ Sòng này đã lắc rồi.', flags: 64 });
            if (Object.keys(session.bets).length === 0) {
                return interaction.reply({ content: '⚠️ Chưa có ai đặt cược, chưa thể lắc. Chờ đạo hữu đặt cược đã!', flags: 64 });
            }
            await interaction.deferUpdate().catch(() => {});
            await shakeSession(sessionId);
        } else {
            if (session.phase !== 'shaken') return interaction.reply({ content: '⚠️ Sòng chưa lắc, chưa có gì để khui.', flags: 64 });
            await interaction.deferUpdate().catch(() => {});
            await revealSession(sessionId);
        }
        return;
    }

    if (!session || session.closed) {
        return interaction.reply({ content: '⚠️ Ván Bầu Cua này đã đóng cược (chủ sòng đã lắc hoặc sòng đã kết thúc). Dùng `/baucua` để mở sòng mới!', flags: 64 });
    }
    if (shutdown.isDraining()) return interaction.reply({ content: shutdown.MAINTENANCE_TEXT, flags: 64 });

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
    if (!session || session.closed) {
        return interaction.reply({ content: '⚠️ Ván Bầu Cua đã đóng cược (chủ sòng đã lắc), cược của đạo hữu chưa bị trừ.', flags: 64 });
    }
    if (shutdown.isDraining()) return interaction.reply({ content: shutdown.MAINTENANCE_TEXT, flags: 64 });

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

    // Ghi sổ rồi trừ tiền ngay (chỉ khi đủ) — không thể cược vượt số dư dù mở nhiều sòng hay tiêu Linh Thạch chỗ khác
    if (!(await escrow.charge(userId, 'baucua', sessionId, betAmount, session.channel?.id))) {
        return interaction.reply({
            content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach.toLocaleString()}\` 💎, cần cược: \`${betAmount.toLocaleString()}\` 💎.`,
            flags: 64
        });
    }

    // Chủ sòng có thể đã lắc trong lúc chờ DB → hoàn lại ngay, không nhận cược muộn
    if (session.closed || activeBaucuaGames.get(sessionId) !== session) {
        await escrow.payout(userId, 'baucua', sessionId, { credit: betAmount, discharge: betAmount })
            .catch(err => console.error('❌ [BauCua] Lỗi hoàn cược trễ:', err));
        return interaction.reply({ content: `⚠️ Chủ sòng vừa lắc xong, đã hoàn lại \`${betAmount.toLocaleString()}\` 💎 cho đạo hữu.`, flags: 64 });
    }

    if (!session.bets[userId]) {
        session.bets[userId] = { username: displayName, beastBets: {} };
    }
    session.bets[userId].username = displayName;
    const userBetsObj = session.bets[userId].beastBets;
    userBetsObj[beastId] = (userBetsObj[beastId] || 0) + betAmount;

    await interaction.reply({
        content: `✅ **Thành công:** Đạo hữu **${displayName}** đã cược **${betAmount.toLocaleString()} Linh Thạch** vào **${beast.emoji} ${beast.name}**!\n` +
                 `💰 Tổng cược ván này của đạo hữu: \`${totalOf(userBetsObj).toLocaleString()}\` Linh Thạch · Còn lại: \`${Math.max(0, profile.linhThach - betAmount).toLocaleString()}\` 💎.`,
        flags: 64
    });
};

module.exports = {
    commands: [baucuaCommand],
    interactions: {
        'bc_modal': handleBaucuaInteractions,
        'bc_rules': handleBaucuaInteractions,
        'bc_shake': handleBaucuaInteractions,
        'bc_open': handleBaucuaInteractions,
        'bc_again': handleBaucuaInteractions,
        'bc_submit': handleBaucuaModalSubmit,
    },
    // Bot tắt êm: sòng đã có người cược thì lắc + khui NGAY để hoàn thành ván; sòng trống thì đóng
    onShutdown: async () => {
        const sessions = [...activeBaucuaGames.values()];
        await Promise.all(sessions.map(async (s) => {
            try {
                if (Object.keys(s.bets).length > 0) {
                    await shakeSession(s.id);
                    await revealSession(s.id);
                } else {
                    await cancelSession(s, 'Bot đang khởi động lại để bảo trì.');
                }
            } catch (err) {
                console.error('❌ [BauCua] xử lý sòng khi tắt:', err);
            }
        }));
    },
    // Liệt kê sòng đang mở trong kênh (cho /banchoi)
    listRooms: (channelId) => [...activeBaucuaGames.values()]
        .filter(s => s.channel?.id === channelId)
        .map(s => ({
            game: '🎲 Bầu Cua',
            title: `Sòng của ${s.hostName}`,
            detail: `👥 ${Object.keys(s.bets).length} người đã cược · ${s.phase === 'betting' ? 'đang nhận cược' : 'đã lắc, chờ khui'}`,
            joinable: s.phase === 'betting',
            url: s.message?.url,
        })),
    _internal: { activeBaucuaGames, shakeSession, revealSession },
};
