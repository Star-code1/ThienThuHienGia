const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const {
    createShoe, handValue, isBlackjack, formatHand, dealerPlay, settleHand
} = require('./blackjackEngine');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');

const MAX_PLAYERS = 6;
const LOBBY_SECONDS = 30;
const TURN_SECONDS = 40;
const WIN_TUVI = 20;

const COLORS = {
    lobby: '#F1C40F',
    playing: '#1ABC9C',
    done: '#9B59B6',
    cancel: '#95A5A6',
};

// Bàn Xì Dách đang mở: channelId -> table
const tables = new Map();

const unix = (ms) => Math.floor(ms / 1000);

function findPlayerTable(userId) {
    for (const t of tables.values()) {
        if (t.players.some(p => p.id === userId)) return t;
    }
    return null;
}

function currentPlayer(table) {
    return table.players[table.turn] || null;
}

// ───────────────────────────── Giao diện ─────────────────────────────

const STATUS_BADGE = {
    playing: '🎯 Đang suy tính',
    waiting: '⌛ Chờ lượt',
    stand: '✋ Đã dằn',
    bust: '💥 Quắc (Quá 21)',
    blackjack: '🌟 XÌ DÁCH!',
};

const RESULT_BADGE = {
    blackjack: '🌟 Xì Dách — Thắng x1.5',
    win: '🏆 Thắng',
    push: '🤝 Hòa',
    lose: '❌ Thua',
    bust: '💥 Quắc — Thua',
};

function playerField(table, p, idx, { reveal }) {
    const { total, soft } = handValue(p.cards);
    const isTurn = table.phase === 'playing' && idx === table.turn;
    const name = `${isTurn ? '▶️' : `${idx + 1}.`} ${p.name}${p.id === table.hostId ? ' 👑' : ''}`;

    const pointsLabel = soft && total < 21 ? `${total - 10}/${total}` : `${total}`;
    let line;
    if (reveal && p.result) {
        const sign = p.delta > 0 ? '+' : '';
        line = `${RESULT_BADGE[p.result.result]}\n💎 **${sign}${p.delta.toLocaleString()}**`;
    } else {
        const status = p.status === 'playing' && !isTurn ? 'waiting' : p.status;
        line = STATUS_BADGE[status];
    }

    return {
        name,
        value:
            `\`\`\`${formatHand(p.cards)}\`\`\`` +
            `Điểm: **${pointsLabel}**${p.doubled ? ' · 💰 Gấp đôi' : ''}\n` +
            line,
        inline: true,
    };
}

function renderLobby(table) {
    const list = table.players
        .map((p, i) => `\`${i + 1}.\` **${p.name}**${p.id === table.hostId ? ' 👑' : ''}`)
        .join('\n');
    const empty = MAX_PLAYERS - table.players.length;

    const embed = new EmbedBuilder()
        .setColor(COLORS.lobby)
        .setTitle('🃏 XÌ DÁCH TIÊN PHỦ • CHIÊU MỘ ĐẠO HỮU 🃏')
        .setDescription(
            `🧙‍♂️ **Nhà cái:** Thiên Thư Hiền Giả\n` +
            `💎 **Mức cược mỗi người:** \`${table.bet.toLocaleString()}\` Linh Thạch\n` +
            `⏳ **Chia bài:** <t:${unix(table.lobbyEndsAt)}:R> (hoặc khi chủ bàn 👑 bấm Bắt đầu)\n\n` +
            `👥 **Đạo hữu tại bàn (${table.players.length}/${MAX_PLAYERS}):**\n${list}` +
            (empty > 0 ? `\n${'`·` *Ghế trống*\n'.repeat(Math.min(empty, 2))}` : '')
        )
        .setFooter({ text: 'Mỗi người đấu riêng với nhà cái • Bấm Tham gia để ngồi vào bàn' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_join').setLabel('Tham gia').setEmoji('🪑').setStyle(ButtonStyle.Success)
            .setDisabled(table.players.length >= MAX_PLAYERS),
        new ButtonBuilder().setCustomId('bj_leave').setLabel('Rời bàn').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('bj_start').setLabel('Bắt đầu').setEmoji('▶️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bj_rules').setLabel('Luật').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    );

    return { content: '', embeds: [embed], components: [row] };
}

function renderPlaying(table) {
    const cur = currentPlayer(table);
    const dealerUp = handValue([table.dealer[0]]).total;

    const embed = new EmbedBuilder()
        .setColor(COLORS.playing)
        .setTitle('🃏 XÌ DÁCH TIÊN PHỦ • VÁN ĐẤU ĐANG DIỄN RA 🃏')
        .setDescription(
            `💎 Cược: \`${table.bet.toLocaleString()}\` Linh Thạch/người\n` +
            (cur
                ? `⏳ **Lượt của <@${cur.id}>** — tự động Dằn <t:${unix(table.turnEndsAt)}:R>`
                : '🧙‍♂️ Nhà cái đang lật bài...')
        )
        .addFields(
            {
                name: '🧙‍♂️ Nhà Cái — Thiên Thư Hiền Giả',
                value: `\`\`\`${formatHand(table.dealer, true)}\`\`\`Điểm lộ: **${dealerUp}** + ❓`,
                inline: false,
            },
            ...table.players.map((p, i) => playerField(table, p, i, { reveal: false }))
        )
        .setFooter({ text: 'Rút: thêm 1 lá • Dằn: giữ bài • Gấp đôi: x2 cược, rút đúng 1 lá rồi dằn' });

    const canDouble = cur && cur.cards.length === 2 && !cur.doubled;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_hit').setLabel('Rút bài').setEmoji('🃏').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bj_stand').setLabel('Dằn').setEmoji('✋').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('bj_double').setLabel('Gấp đôi').setEmoji('💰').setStyle(ButtonStyle.Success)
            .setDisabled(!canDouble),
        new ButtonBuilder().setCustomId('bj_rules').setLabel('Luật').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    );

    return { content: '', embeds: [embed], components: [row] };
}

function renderResult(table) {
    const { total: dealerTotal } = handValue(table.dealer);
    const dealerLabel = isBlackjack(table.dealer)
        ? '🌟 XÌ DÁCH!'
        : dealerTotal > 21 ? `💥 Quắc (${dealerTotal})` : `**${dealerTotal}** điểm`;

    const winners = table.players.filter(p => p.delta > 0);
    const houseNet = -table.players.reduce((s, p) => s + p.delta, 0);

    const embed = new EmbedBuilder()
        .setColor(COLORS.done)
        .setTitle('⚔️ XÌ DÁCH TIÊN PHỦ • KẾT QUẢ VÁN ĐẤU ⚔️')
        .setDescription(
            (winners.length
                ? `🏆 **Thắng nhà cái:** ${winners.map(p => `**${p.name}**`).join(', ')}`
                : '🧙‍♂️ **Nhà cái thắng trọn bàn!**') +
            `\n🏦 Nhà cái ${houseNet >= 0 ? 'thu' : 'chi'}: \`${Math.abs(houseNet).toLocaleString()}\` Linh Thạch`
        )
        .addFields(
            {
                name: '🧙‍♂️ Nhà Cái — Thiên Thư Hiền Giả',
                value: `\`\`\`${formatHand(table.dealer)}\`\`\`${dealerLabel}`,
                inline: false,
            },
            ...table.players.map((p, i) => playerField(table, p, i, { reveal: true }))
        )
        .setFooter({ text: `Thắng được thưởng +${WIN_TUVI} Tu Vi • Hồng Trần Đổ Đạo • Thiên Thư Môn` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bj_again:${table.bet}`).setLabel('Mở bàn mới').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('bj_rules').setLabel('Luật').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    );

    return { content: '', embeds: [embed], components: [row] };
}

function rulesEmbed() {
    return new EmbedBuilder()
        .setColor(COLORS.lobby)
        .setTitle('📖 LUẬT CHƠI XÌ DÁCH TIÊN PHỦ (BLACKJACK)')
        .setDescription(
            `🃏 **Mục tiêu:** Có tổng điểm gần **21** nhất mà không vượt quá, và cao hơn nhà cái.\n\n` +
            `🔢 **Cách tính điểm:**\n` +
            `• Lá 2–10 tính đúng số • J, Q, K = **10** • A = **11** hoặc **1**\n\n` +
            `👥 **Chơi chung:**\n` +
            `• Một người mở bàn bằng \`/xidach\`, tối đa **${MAX_PLAYERS}** đạo hữu cùng ngồi.\n` +
            `• Mỗi người đấu **riêng** với nhà cái Hiền Giả, lần lượt theo thứ tự ghế.\n` +
            `• Mỗi lượt có **${TURN_SECONDS} giây**, hết giờ tự động Dằn.\n\n` +
            `🎮 **Hành động:**\n` +
            `• 🃏 **Rút** thêm 1 lá • ✋ **Dằn** giữ bài\n` +
            `• 💰 **Gấp đôi**: chỉ với 2 lá đầu, nhân đôi cược và rút đúng 1 lá\n\n` +
            `🧙‍♂️ **Nhà cái** rút đến khi đạt từ 17 điểm.\n\n` +
            `💰 **Trả thưởng:**\n` +
            `• 🌟 Xì Dách (A + lá 10 điểm ngay 2 lá đầu): **x1.5** cược\n` +
            `• 🏆 Thắng: **x1** cược • 🤝 Hòa: hoàn cược\n` +
            `• 💥 Quắc (quá 21) hoặc thua: mất cược\n` +
            `• Thắng được thưởng thêm **+${WIN_TUVI} Tu Vi**`
        )
        .setFooter({ text: 'Thiên Thư Hiền Giả Ban Luật' });
}

// ───────────────────────────── Logic bàn chơi ─────────────────────────────

async function editTable(table, payload) {
    try {
        await table.message.edit(payload);
    } catch (err) {
        console.error('❌ [Blackjack] Không thể cập nhật bàn:', err.message);
    }
}

async function openTable(interaction, bet) {
    const channelId = interaction.channelId;
    const existing = tables.get(channelId);
    if (existing) {
        return interaction.reply({
            content: '⚠️ Kênh này đang có một bàn Xì Dách! Hãy tham gia bàn đó hoặc đợi ván kết thúc.',
            flags: 64,
        });
    }

    if (findPlayerTable(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ Đạo hữu đang ngồi ở một bàn Xì Dách khác rồi!', flags: 64 });
    }

    const displayName = getDisplayName(interaction);
    const profile = await UserProfile.getOrCreate(interaction.user.id, displayName);
    if (profile.linhThach < bet) {
        return interaction.reply({
            content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach.toLocaleString()}\` 💎, cần cược: \`${bet.toLocaleString()}\` 💎.`,
            flags: 64,
        });
    }

    const table = {
        channelId,
        hostId: interaction.user.id,
        bet,
        phase: 'lobby',
        players: [{ id: interaction.user.id, name: displayName, cards: [], status: 'playing', doubled: false }],
        dealer: [],
        shoe: null,
        turn: -1,
        message: null,
        lobbyEndsAt: Date.now() + LOBBY_SECONDS * 1000,
        lobbyTimer: null,
        turnTimer: null,
        turnEndsAt: 0,
    };
    tables.set(channelId, table);

    await interaction.reply(renderLobby(table));
    table.message = await interaction.fetchReply();

    table.lobbyTimer = setTimeout(() => {
        if (tables.get(channelId) === table && table.phase === 'lobby') {
            startGame(table).catch(err => console.error('❌ [Blackjack] startGame:', err));
        }
    }, LOBBY_SECONDS * 1000);
}

async function startGame(table) {
    clearTimeout(table.lobbyTimer);
    table.phase = 'playing';
    table.shoe = createShoe(2);

    for (let round = 0; round < 2; round++) {
        for (const p of table.players) p.cards.push(table.shoe.pop());
        table.dealer.push(table.shoe.pop());
    }
    for (const p of table.players) {
        if (isBlackjack(p.cards)) p.status = 'blackjack';
    }

    // Nhà cái có Xì Dách → lật bài ngay, kết thúc ván
    if (isBlackjack(table.dealer)) {
        return finishGame(table);
    }

    table.turn = -1;
    return advanceTurn(table);
}

async function advanceTurn(table) {
    clearTimeout(table.turnTimer);
    const next = table.players.findIndex((p, i) => i > table.turn && p.status === 'playing');

    if (next === -1) {
        table.turn = table.players.length;
        return finishGame(table);
    }

    table.turn = next;
    table.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
    const turnIndex = next;
    table.turnTimer = setTimeout(() => {
        if (tables.get(table.channelId) !== table || table.phase !== 'playing' || table.turn !== turnIndex) return;
        table.players[turnIndex].status = 'stand';
        advanceTurn(table).catch(err => console.error('❌ [Blackjack] auto-stand:', err));
    }, TURN_SECONDS * 1000);

    await editTable(table, renderPlaying(table));
}

async function finishGame(table) {
    if (table.phase === 'done') return;
    table.phase = 'done';
    clearTimeout(table.turnTimer);
    clearTimeout(table.lobbyTimer);
    tables.delete(table.channelId);

    // Nhà cái chỉ cần rút nếu còn người chưa Quắc
    if (table.players.some(p => p.status !== 'bust')) {
        dealerPlay(table.dealer, table.shoe);
    }

    for (const p of table.players) {
        const stake = table.bet * (p.doubled ? 2 : 1);
        p.result = settleHand(p.cards, table.dealer);
        p.delta = Math.round(stake * p.result.multiplier);

        try {
            const profile = await UserProfile.getOrCreate(p.id, p.name);
            if (p.delta < 0) {
                const loss = Math.min(-p.delta, Math.max(profile.linhThach, 0));
                p.delta = -loss;
            }
            profile.linhThach += p.delta;
            profile.stats.blackjackGames = (profile.stats.blackjackGames || 0) + 1;
            if (p.delta > 0) {
                profile.stats.blackjackWins = (profile.stats.blackjackWins || 0) + 1;
                profile.addTuVi(WIN_TUVI);
            }
            await profile.save();
        } catch (err) {
            console.error(`❌ [Blackjack] Lỗi cập nhật Linh Thạch cho ${p.id}:`, err);
        }
    }

    await editTable(table, renderResult(table));
}

// ───────────────────────────── Lệnh & nút ─────────────────────────────

const blackjackCommand = {
    data: new SlashCommandBuilder()
        .setName('xidach')
        .setDescription('🃏 Mở bàn Xì Dách (Blackjack) chơi chung, cùng đấu với nhà cái Thiên Thư Hiền Giả')
        .addIntegerOption(option =>
            option.setName('cuoc')
                .setDescription('Mức Linh Thạch cược cho mỗi người (Mặc định: 200)')
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(20000)
        ),
    async execute(interaction) {
        const bet = interaction.options.getInteger('cuoc') || 200;
        return openTable(interaction, bet);
    }
};

const handleBlackjackButtons = async (interaction) => {
    const [action, arg] = interaction.customId.split(':');

    if (action === 'bj_rules') {
        return interaction.reply({ embeds: [rulesEmbed()], flags: 64 });
    }

    if (action === 'bj_again') {
        return openTable(interaction, parseInt(arg, 10) || 200);
    }

    const table = tables.get(interaction.channelId);
    if (!table || table.message?.id !== interaction.message.id) {
        return interaction.reply({ content: 'Bàn Xì Dách này đã kết thúc hoặc không tồn tại.', flags: 64 });
    }

    const userId = interaction.user.id;
    const displayName = getDisplayName(interaction);

    // ── Phòng chờ ──
    if (action === 'bj_join') {
        if (table.phase !== 'lobby') return interaction.reply({ content: '⚠️ Ván đã bắt đầu, hãy đợi ván sau!', flags: 64 });
        if (table.players.some(p => p.id === userId)) return interaction.reply({ content: 'Đạo hữu đã ngồi tại bàn rồi!', flags: 64 });
        if (findPlayerTable(userId)) return interaction.reply({ content: '⚠️ Đạo hữu đang ngồi ở một bàn Xì Dách khác rồi!', flags: 64 });
        if (table.players.length >= MAX_PLAYERS) return interaction.reply({ content: '⚠️ Bàn đã đủ người!', flags: 64 });

        const profile = await UserProfile.getOrCreate(userId, displayName);
        if (profile.linhThach < table.bet) {
            return interaction.reply({
                content: `⚠️ Đạo hữu không đủ Linh Thạch! Hiện có: \`${profile.linhThach.toLocaleString()}\` 💎, cần: \`${table.bet.toLocaleString()}\` 💎.`,
                flags: 64,
            });
        }
        // Kiểm tra lại sau await để tránh trùng ghế
        if (table.phase !== 'lobby' || table.players.length >= MAX_PLAYERS || table.players.some(p => p.id === userId)) {
            return interaction.reply({ content: '⚠️ Không thể vào bàn lúc này.', flags: 64 });
        }

        table.players.push({ id: userId, name: displayName, cards: [], status: 'playing', doubled: false });
        return interaction.update(renderLobby(table));
    }

    if (action === 'bj_leave') {
        if (table.phase !== 'lobby') return interaction.reply({ content: '⚠️ Ván đã bắt đầu, không thể rời bàn!', flags: 64 });
        const idx = table.players.findIndex(p => p.id === userId);
        if (idx === -1) return interaction.reply({ content: 'Đạo hữu chưa ngồi tại bàn này.', flags: 64 });

        table.players.splice(idx, 1);
        if (table.players.length === 0) {
            clearTimeout(table.lobbyTimer);
            tables.delete(table.channelId);
            const embed = new EmbedBuilder()
                .setColor(COLORS.cancel)
                .setTitle('🃏 XÌ DÁCH TIÊN PHỦ • BÀN ĐÃ GIẢI TÁN')
                .setDescription('Không còn đạo hữu nào tại bàn. Dùng `/xidach` để mở bàn mới.');
            return interaction.update({ embeds: [embed], components: [] });
        }
        if (table.hostId === userId) table.hostId = table.players[0].id;
        return interaction.update(renderLobby(table));
    }

    if (action === 'bj_start') {
        if (table.phase !== 'lobby') return interaction.reply({ content: 'Ván đã bắt đầu rồi!', flags: 64 });
        if (userId !== table.hostId) return interaction.reply({ content: '⚠️ Chỉ chủ bàn 👑 mới được bắt đầu sớm.', flags: 64 });
        await interaction.deferUpdate();
        return startGame(table);
    }

    // ── Trong ván ──
    if (!['bj_hit', 'bj_stand', 'bj_double'].includes(action)) return;
    if (table.phase !== 'playing') return interaction.reply({ content: 'Ván chưa bắt đầu hoặc đã kết thúc.', flags: 64 });

    const player = currentPlayer(table);
    if (!player || player.id !== userId) {
        const seated = table.players.some(p => p.id === userId);
        return interaction.reply({
            content: seated ? '⌛ Chưa tới lượt của đạo hữu!' : '⚠️ Đạo hữu không ngồi tại bàn này.',
            flags: 64,
        });
    }

    if (action === 'bj_double') {
        if (player.cards.length !== 2 || player.doubled) {
            return interaction.reply({ content: '⚠️ Chỉ được Gấp đôi với 2 lá đầu tiên.', flags: 64 });
        }
        const profile = await UserProfile.getOrCreate(userId, displayName);
        if (profile.linhThach < table.bet * 2) {
            return interaction.reply({
                content: `⚠️ Cần \`${(table.bet * 2).toLocaleString()}\` 💎 để Gấp đôi, đạo hữu chỉ có \`${profile.linhThach.toLocaleString()}\` 💎.`,
                flags: 64,
            });
        }
        // Trạng thái có thể đã đổi trong lúc chờ DB (vd: hết giờ)
        if (currentPlayer(table) !== player || player.doubled || table.phase !== 'playing') {
            return interaction.reply({ content: '⌛ Lượt của đạo hữu đã kết thúc.', flags: 64 });
        }
        player.doubled = true;
        player.cards.push(table.shoe.pop());
        player.status = handValue(player.cards).total > 21 ? 'bust' : 'stand';
        await interaction.deferUpdate();
        return advanceTurn(table);
    }

    if (action === 'bj_hit') {
        player.cards.push(table.shoe.pop());
        const { total } = handValue(player.cards);
        await interaction.deferUpdate();
        if (total > 21) {
            player.status = 'bust';
            return advanceTurn(table);
        }
        if (total === 21) {
            player.status = 'stand';
            return advanceTurn(table);
        }
        return editTable(table, renderPlaying(table));
    }

    if (action === 'bj_stand') {
        player.status = 'stand';
        await interaction.deferUpdate();
        return advanceTurn(table);
    }
};

module.exports = {
    commands: [blackjackCommand],
    interactions: {
        'bj_join': handleBlackjackButtons,
        'bj_leave': handleBlackjackButtons,
        'bj_start': handleBlackjackButtons,
        'bj_rules': handleBlackjackButtons,
        'bj_hit': handleBlackjackButtons,
        'bj_stand': handleBlackjackButtons,
        'bj_double': handleBlackjackButtons,
        'bj_again': handleBlackjackButtons,
    }
};
