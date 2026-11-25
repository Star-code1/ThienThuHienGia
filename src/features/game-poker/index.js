const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const T = require('./pokerTable');
const { evaluate7Cards } = require('./pokerEngine');
const { generatePokerCommentary } = require('../../services/aiService');
const UserProfile = require('../../shared/models/UserProfile');
const { getDisplayName } = require('../../shared/utils/nameHelper');
const escrow = require('../../services/escrowService');

const TURN_TIMEOUT_MS = 60_000;
const LOBBY_TIMEOUT_MS = 5 * 60_000;
const BOT_STACK_MULTIPLIER = 30;
const BUY_IN_MULTIPLIER = 20; // tiền mua chip khi ngồi vào bàn = 20 × mức cược, bị trừ ngay khỏi Linh Thạch
const BOT_NAMES = ['Thiên Thư Hiền Giả', 'Kiếm Khách Vô Danh', 'Hồ Ly Tinh', 'Lão Ăn Mày', 'Tiểu Sư Muội'];
const COLOR = { table: 0x9B59B6, lobby: 0x5865F2, win: 0x2ECC71, lose: 0xE74C3C, closed: 0x95A5A6 };

const tables = new Map();   // tableId -> table

const fmt = (n) => Number(n).toLocaleString('vi-VN');
const cardStr = (cards) => cards.map(String).join('  ');
const boardStr = (board) => [...board.map(String), ...Array(5 - board.length).fill('🂠')].join('  ');
const isPlaying = (table) => T.STAGES.includes(table.stage);
const humans = (table) => table.players.filter((p) => !p.isBot);
const buyInOf = (table) => table.bet * BUY_IN_MULTIPLIER;

// ── Tiền mua chip (buy-in): trừ khi vào bàn, hoàn phần còn lại khi rời/đóng bàn ────────────
async function cashOutAmount(userId, amount) {
    if (!(amount > 0)) return;
    try {
        await UserProfile.incLinhThachById(userId, amount);
    } catch (e) {
        console.error(`[Poker] Lỗi hoàn ${amount} Linh Thạch cho ${userId}:`, e.message);
    }
}

/** Số chip phải trả lại cho một ghế (ván đang dở bị huỷ thì trả cả phần đã bỏ vào pot). */
function chipsOwed(table, p) {
    return p.stack + (isPlaying(table) ? p.total : 0);
}

/** Trả chip của một người về Linh Thạch rồi xoá chip khỏi ghế (chống trả hai lần). */
function cashOutSeat(table, p) {
    if (p.isBot) return Promise.resolve();
    const amount = chipsOwed(table, p);
    p.stack = 0;
    p.total = 0;
    return cashOutAmount(p.id, amount).then(() => escrow.release(p.id, 'poker', table.id));
}

// ── Khóa tuần tự mỗi bàn (tránh 2 click xử lý chồng nhau) ─────────────────────
function withLock(table, fn) {
    const run = (table.lock || Promise.resolve()).then(fn, fn);
    table.lock = run.catch(() => {});
    return run;
}

// ── Giao diện ─────────────────────────────────────────────────────────────────

function seatLine(table, p, i) {
    const turn = isPlaying(table) && i === table.toAct;
    const icon = p.isBot ? '🤖' : '👤';
    const host = p.id === table.hostId ? ' 👑' : '';
    let state = `💎 ${fmt(p.stack)}`;
    if (isPlaying(table)) {
        if (p.folded) return `🏳️ ~~${p.name}~~ · bỏ bài`;
        if (p.bet > 0) state += ` · đặt **${fmt(p.bet)}**`;
        if (p.allIn) state += ' · 🔥 **ALL-IN**';
    }
    return `${turn ? '▶️' : '▫️'} ${icon} **${p.name}**${host} — ${state}`;
}

function btn(table, action, label, style, disabled = false) {
    return new ButtonBuilder().setCustomId(`pk:${table.id}:${action}`).setLabel(label).setStyle(style).setDisabled(disabled);
}

function renderPlaying(table) {
    const legal = T.legalActions(table);
    const actor = legal.player;
    const me = table.mode === 'solo' ? humans(table)[0] : null;

    let desc =
        `**Bàn chung**\n# ${boardStr(table.board)}\n` +
        `💰 **Pot:** ${fmt(T.pot(table))} 💎` +
        (table.currentBet > 0 ? `   •   📈 **Cược vòng này:** ${fmt(table.currentBet)}` : '');
    if (me && me.hole.length) {
        const hand = table.board.length >= 3 ? ` → *${evaluate7Cards([...me.hole, ...table.board]).rankName}*` : '';
        desc += `\n\n🎴 **Bài của bạn:** ${cardStr(me.hole)}${hand}`;
    }

    const embed = new EmbedBuilder()
        .setColor(COLOR.table)
        .setAuthor({ name: `Hồng Trần Poker • Ván #${table.handNo} • Cược ${fmt(table.bet)} 💎` })
        .setTitle(`🃏 Vòng ${T.STAGE_NAMES[table.stage]}`)
        .setDescription(desc)
        .addFields(
            { name: `👥 Người chơi (${table.players.length})`, value: table.players.map((p, i) => seatLine(table, p, i)).join('\n') },
            { name: '📜 Diễn biến', value: table.log.join('\n') || '—' }
        )
        .setFooter({ text: `⏳ Lượt của ${actor.name} • ${TURN_TIMEOUT_MS / 1000} giây • Tố cố định +${fmt(T.raiseSize(table))}` });

    const row = new ActionRowBuilder().addComponents(
        btn(table, 'call', legal.canCheck ? '✋ Xem' : `📥 Theo ${fmt(legal.toCall)}`, ButtonStyle.Success),
        btn(table, 'raise', `🔥 Tố lên ${fmt(actor.bet + legal.raiseCost)}`, ButtonStyle.Primary, !legal.canRaise),
        btn(table, 'allin', `💥 All-in ${fmt(legal.allInTo)}`, ButtonStyle.Danger, !legal.canAllIn),
        btn(table, 'fold', '🏳️ Bỏ bài', ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder();
    if (table.mode !== 'solo') row2.addComponents(btn(table, 'view', '🂠 Xem bài', ButtonStyle.Secondary));
    row2.addComponents(btn(table, 'rules', '📖 Luật', ButtonStyle.Secondary));
    return { content: actor.isBot ? '' : `🎯 <@${actor.id}> tới lượt bạn!`, embeds: [embed], components: [row, row2] };
}

function resultLines(result) {
    const sorted = [...result.rows].sort((a, b) => b.net - a.net);
    return sorted.map((r) => {
        const medal = r.won > 0 ? '🏆' : r.folded ? '🏳️' : '▫️';
        const icon = r.isBot ? '🤖' : '👤';
        const cards = result.showdown && !r.folded ? ` · ${cardStr(r.hole)} → *${r.hand}*` : r.folded ? ' · bỏ bài' : '';
        const net = r.net > 0 ? `**+${fmt(r.net)}**` : r.net < 0 ? `-${fmt(-r.net)}` : '±0';
        return `${medal} ${icon} **${r.name}**${cards} — ${net} 💎`;
    }).join('\n');
}

function renderLobby(table) {
    const host = table.players.find((p) => p.id === table.hostId);
    const r = table.lastResult;
    const embed = new EmbedBuilder()
        .setAuthor({ name: `Hồng Trần Poker • ${table.mode === 'solo' ? 'Solo với máy' : 'Bàn chung'} • Cược ${fmt(table.bet)} 💎` });

    if (r) {
        const myNet = table.mode === 'solo' ? r.rows.find((x) => !x.isBot)?.net ?? 0 : null;
        embed
            .setColor(myNet === null ? COLOR.table : myNet >= 0 ? COLOR.win : COLOR.lose)
            .setTitle(`🏁 Kết quả ván #${table.handNo}`)
            .setDescription(`**Bàn chung**\n# ${boardStr(r.board)}\n💰 **Pot:** ${fmt(r.pot)} 💎`)
            .addFields({ name: r.showdown ? '⚔️ Lật bài' : '🏳️ Các nhà khác bỏ bài', value: resultLines(r).slice(0, 1024) });
        if (r.commentary) embed.addFields({ name: '☯️ Hiền Giả bình', value: `*${r.commentary}*`.slice(0, 1024) });
    } else {
        embed
            .setColor(COLOR.lobby)
            .setTitle(`🪑 Bàn của ${host?.name || 'chủ bàn'} — đang chờ`)
            .setDescription(
                'Bấm **Tham gia** để ngồi vào bàn, chủ bàn có thể **Thêm máy** 🤖.\n' +
                `Đủ từ 2 người là **Bắt đầu** được (tối đa ${T.MAX_SEATS}).`
            );
    }
    embed.addFields({
        name: `👥 Chỗ ngồi (${table.players.length}/${T.MAX_SEATS})`,
        value: table.players.map((p, i) => seatLine(table, p, i)).join('\n') || '—',
    });
    embed.setFooter({ text: `Bàn tự giải tán sau ${LOBBY_TIMEOUT_MS / 60000} phút không hoạt động` });

    const row = new ActionRowBuilder();
    if (table.mode === 'chung') {
        row.addComponents(
            btn(table, 'join', '🪑 Tham gia', ButtonStyle.Success, table.players.length >= T.MAX_SEATS),
            btn(table, 'leave', '🚪 Rời bàn', ButtonStyle.Secondary),
            btn(table, 'addbot', '🤖 Thêm máy', ButtonStyle.Secondary, table.players.length >= T.MAX_SEATS)
        );
    }
    row.addComponents(
        btn(table, 'start', r ? '▶️ Ván tiếp' : '▶️ Bắt đầu', ButtonStyle.Primary, table.players.length < 2),
        btn(table, 'end', '⛔ Giải tán', ButtonStyle.Danger)
    );
    const rulesRow = new ActionRowBuilder().addComponents(btn(table, 'rules', '📖 Luật chơi', ButtonStyle.Secondary));
    return { content: '', embeds: [embed], components: [row, rulesRow] };
}

const render = (table) => (isPlaying(table) ? renderPlaying(table) : renderLobby(table));

// ── Vòng đời bàn ─────────────────────────────────────────────────────────────

function closeTable(table, reason) {
    clearTimeout(table.timer);
    tables.delete(table.id);
    const payload = render(table);
    payload.components = [];
    payload.content = '';
    payload.embeds[0].setColor(COLOR.closed).setFooter({ text: `⛔ ${reason}` });
    // Trả lại chip còn lại cho người chơi (sau khi đã dựng xong giao diện)
    table.cashOutPromise = Promise.all(humans(table).map((p) => cashOutSeat(table, p)));
    return payload;
}

async function editTableMessage(table, payload) {
    await table.message?.edit(payload).catch((e) => console.warn('[Poker] Không sửa được tin nhắn bàn:', e.message));
}

/** Đặt lại hẹn giờ: hết lượt (đang chơi) hoặc tự giải tán (đang chờ). */
function armTimer(table) {
    clearTimeout(table.timer);
    const token = Symbol('timer');
    table.timerToken = token;
    const playing = isPlaying(table);
    table.timer = setTimeout(() => withLock(table, async () => {
        if (table.timerToken !== token || !tables.has(table.id)) return;
        if (!playing) {
            return editTableMessage(table, closeTable(table, 'Bàn đã tự giải tán do không hoạt động'));
        }
        const legal = T.legalActions(table);
        if (!legal || legal.player.isBot) return;
        T.act(table, legal.player.id, legal.canCheck ? 'check' : 'fold');
        table.log[table.log.length - 1] += ' *(hết giờ)*';
        await afterAction(table);
        await editTableMessage(table, render(table));
    }), playing ? TURN_TIMEOUT_MS : LOBBY_TIMEOUT_MS);
}

/** Sau mỗi hành động: cho máy đánh, nếu hết ván thì chốt Linh Thạch. */
async function afterAction(table) {
    T.runBots(table);
    if (!isPlaying(table) && table.lastResult && !table.lastResult.settled) {
        table.lastResult.settled = true;
        await settleHand(table);
        requestCommentary(table);
    }
    armTimer(table);
}

async function settleHand(table) {
    for (const p of humans(table)) await escrow.setAmount(p.id, 'poker', table.id, p.stack);
    for (const row of table.lastResult.rows) {
        if (row.isBot) continue;
        try {
            const profile = await UserProfile.getOrCreate(row.id, row.name);
            const inc = { 'stats.pokerGames': 1 };
            if (row.net > 0) inc['stats.pokerWins'] = 1;
            await profile.incLinhThach(0, { inc }); // Linh Thạch nằm trong chip tại bàn, chỉ ghi thống kê
            if (row.net > 0) {
                profile.addTuVi(30);
                await profile.save();
            }
        } catch (e) {
            console.error(`[Poker] Lỗi lưu kết quả cho ${row.id}:`, e.message);
        }
    }
}

function requestCommentary(table) {
    const result = table.lastResult;
    const winner = [...result.rows].sort((a, b) => b.net - a.net)[0];
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
    Promise.race([
        generatePokerCommentary(result.showdown ? 'Showdown' : 'Bỏ bài', result.board.map(String), winner.name, result.showdown ? winner.hand : 'đối thủ bỏ bài'),
        timeout,
    ]).then((text) => withLock(table, async () => {
        if (!text || table.lastResult !== result || !tables.has(table.id) || isPlaying(table)) return;
        result.commentary = String(text).replace(/^["“]|["”]$/g, '');
        await editTableMessage(table, render(table));
    })).catch(() => {});
}

/** Trước mỗi ván: nạp lại chip cho máy, loại người không còn đủ chip để đặt ante. */
async function refreshStacks(table) {
    const kicked = [];
    for (const p of [...table.players]) {
        if (p.isBot) {
            if (p.stack < table.bet) p.stack = table.bet * BOT_STACK_MULTIPLIER;
            continue;
        }
        if (p.stack < table.bet) {
            kicked.push(p.name);
            await cashOutSeat(table, p); // trả nốt phần chip lẻ
            T.removePlayer(table, p.id);
        }
    }
    return kicked;
}

function addBot(table) {
    const used = new Set(table.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Máy ${table.players.length + 1}`;
    return T.addPlayer(table, { id: `bot:${table.id}:${table.players.length}:${Date.now()}`, name, stack: table.bet * BOT_STACK_MULTIPLIER, isBot: true });
}

// ── Lệnh /poker ──────────────────────────────────────────────────────────────

const pokerCommand = {
    data: new SlashCommandBuilder()
        .setName('poker')
        .setDescription('🃏 Hồng Trần Poker (Texas Hold\'em) — solo với máy hoặc mở bàn chơi chung')
        .addStringOption((o) => o.setName('che_do')
            .setDescription('Chơi solo với máy hay mở bàn chơi chung (mặc định: solo)')
            .addChoices(
                { name: '🤖 Solo với máy', value: 'solo' },
                { name: '👥 Chơi chung (mở bàn cho mọi người vào)', value: 'chung' }
            ))
        .addIntegerOption((o) => o.setName('cuoc')
            .setDescription('Mức cược mỗi ván (ante & bước tố). Mặc định: 200')
            .setMinValue(50)
            .setMaxValue(20000))
        .addIntegerOption((o) => o.setName('so_may')
            .setDescription('Số máy cùng bàn khi chơi solo (1–5, mặc định 1)')
            .setMinValue(1)
            .setMaxValue(5)),

    async execute(interaction) {
        const mode = interaction.options.getString('che_do') || 'solo';
        const bet = interaction.options.getInteger('cuoc') || 200;
        const botCount = interaction.options.getInteger('so_may') || 1;
        const userId = interaction.user.id;
        const displayName = getDisplayName(interaction);

        // Một người được mở/ngồi nhiều bàn cùng lúc — chip mua riêng cho từng bàn
        const buyIn = bet * BUY_IN_MULTIPLIER;
        const profile = await UserProfile.getOrCreate(userId, displayName);
        if (await profile.incLinhThach(-buyIn, { requireFunds: true }) === null) {
            return interaction.reply({ content: `⚠️ Không đủ Linh Thạch! Hiện có **${fmt(profile.linhThach)}** 💎, cần **${fmt(buyIn)}** 💎 mua chip (${BUY_IN_MULTIPLIER}× mức cược).`, flags: 64 });
        }

        const table = T.createTable({ id: interaction.id, mode, bet, hostId: userId });
        T.addPlayer(table, { id: userId, name: displayName, stack: buyIn });
        tables.set(table.id, table);
        await escrow.hold(userId, 'poker', table.id, buyIn, interaction.channelId);

        if (mode === 'solo') {
            for (let i = 0; i < botCount; i++) addBot(table);
            T.startHand(table);
            await afterAction(table);
        } else {
            armTimer(table);
        }

        try {
            const res = await interaction.reply({ ...render(table), withResponse: true });
            table.message = res.resource?.message || null;
        } catch (err) {
            console.error('[Poker] Không đăng được bàn:', err.message);
            closeTable(table, 'Không đăng được bàn'); // trả lại chip
            await table.cashOutPromise;
        }
    },
};

// ── Nút bấm ──────────────────────────────────────────────────────────────────

const RULES_EMBED = new EmbedBuilder()
    .setColor(COLOR.table)
    .setTitle('📖 Luật Hồng Trần Poker (Texas Hold\'em)')
    .setDescription(
        '**Diễn biến ván**\n' +
        '• Vào bàn phải **mua chip** = ' + BUY_IN_MULTIPLIER + '× mức cược (trừ ngay khỏi Linh Thạch); rời/đóng bàn được hoàn chip còn lại.\n' +
        '• Mỗi ván người chơi đặt **ante** = mức cược, nhận 2 lá bài riêng.\n' +
        '• 4 vòng cược: **Preflop → Flop** (3 lá chung) **→ Turn** (lá 4) **→ River** (lá 5).\n' +
        '• Ghép 2 lá riêng + 5 lá chung thành bộ 5 lá mạnh nhất. Còn từ 2 người tới cuối thì lật bài.\n\n' +
        '**Hành động mỗi lượt**\n' +
        '✋ **Xem** — không cược thêm (khi chưa ai tố)\n' +
        '📥 **Theo** — bỏ bằng số người đang tố cao nhất\n' +
        '🔥 **Tố** — nâng cược: +1× (Preflop/Flop), +2× (Turn/River), tối đa 4 lần/vòng\n' +
        '💥 **All-in** — dồn TOÀN BỘ chip còn lại bất cứ lúc nào (kể cả khi đã hết lượt tố); phần tiền thừa so với người còn lại được chia pot phụ đúng luật\n' +
        '🏳️ **Bỏ bài** — mất phần đã cược\n' +
        `⏳ Quá ${TURN_TIMEOUT_MS / 1000}s không bấm: tự Xem (nếu được) hoặc Bỏ bài.\n` +
        'Thiếu tiền để theo → tự **All-in**, pot phụ được chia đúng luật.\n\n' +
        '**Thứ tự bài (mạnh → yếu)**\n' +
        'Thùng Phá Sảnh › Tứ Quý › Cù Lũ › Thùng › Sảnh › Sám Cô › Hai Đôi › Một Đôi › Mậu Thầu\n\n' +
        '🎁 Thắng ván: nhận Linh Thạch + **30 Tu Vi**.'
    );

async function handlePokerButtons(interaction) {
    const [, tableId, action] = interaction.customId.split(':');
    if (action === 'rules') return interaction.reply({ embeds: [RULES_EMBED], flags: 64 });

    const table = tables.get(tableId);
    if (!table) return interaction.reply({ content: 'Bàn Poker này đã giải tán.', flags: 64 });

    const userId = interaction.user.id;
    const seat = table.players.find((p) => p.id === userId);

    if (action === 'view') {
        if (!seat) return interaction.reply({ content: 'Đạo hữu không ngồi ở bàn này.', flags: 64 });
        if (!isPlaying(table) || !seat.hole.length) return interaction.reply({ content: 'Ván chưa bắt đầu.', flags: 64 });
        const hand = evaluate7Cards([...seat.hole, ...table.board]).rankName;
        return interaction.reply({
            content: `🎴 **Bài của bạn:** ${cardStr(seat.hole)}${table.board.length >= 3 ? `\n🃏 Hiện có: **${hand}**` : ''}`,
            flags: 64,
        });
    }

    await interaction.deferUpdate();
    table.message = interaction.message;
    const reply = (content) => interaction.followUp({ content, flags: 64 }).catch(() => {});

    await withLock(table, async () => {
        if (!tables.has(table.id)) return reply('Bàn Poker này đã giải tán.');

        if (['fold', 'call', 'raise', 'allin'].includes(action)) {
            if (!isPlaying(table)) return reply('Ván này đã kết thúc.');
            const err = T.act(table, userId, action);
            if (err) return reply(err);
            await afterAction(table);
            return interaction.editReply(render(table));
        }

        if (isPlaying(table)) return reply('Ván đang diễn ra, đợi hết ván nhé.');

        switch (action) {
            case 'join': {
                if (seat) return reply('Đạo hữu đã ngồi bàn này rồi.');
                const name = getDisplayName(interaction);
                const buyIn = buyInOf(table);
                const profile = await UserProfile.getOrCreate(userId, name);
                if (await profile.incLinhThach(-buyIn, { requireFunds: true }) === null) {
                    return reply(`Cần **${fmt(buyIn)}** 💎 để mua chip vào bàn (${BUY_IN_MULTIPLIER}× mức cược). Đạo hữu đang có **${fmt(profile.linhThach)}** 💎.`);
                }
                const err = tables.has(table.id)
                    ? T.addPlayer(table, { id: userId, name, stack: buyIn })
                    : 'Không thể vào bàn lúc này.';
                if (err) {
                    await cashOutAmount(userId, buyIn);
                    return reply(`${err} Tiền mua chip đã được hoàn lại.`);
                }
                await escrow.hold(userId, 'poker', table.id, buyIn, interaction.channelId);
                break;
            }
            case 'leave': {
                if (!seat) return reply('Đạo hữu không ngồi ở bàn này.');
                await cashOutSeat(table, seat); // trả chip còn lại
                T.removePlayer(table, userId);
                if (table.hostId === userId) {
                    const next = humans(table)[0];
                    if (!next) return interaction.editReply(closeTable(table, 'Chủ bàn đã rời, bàn giải tán'));
                    table.hostId = next.id;
                }
                break;
            }
            case 'addbot':
                if (userId !== table.hostId) return reply('Chỉ chủ bàn 👑 mới thêm máy được.');
                {
                    const err = addBot(table);
                    if (err) return reply(err);
                }
                break;
            case 'start': {
                if (!seat) return reply('Chỉ người ngồi trong bàn mới bắt đầu được.');
                const kicked = await refreshStacks(table);
                if (!humans(table).length) return interaction.editReply(closeTable(table, 'Không còn ai đủ Linh Thạch'));
                const err = T.startHand(table);
                if (err) {
                    armTimer(table);
                    await interaction.editReply(render(table));
                    return reply(err);
                }
                if (kicked.length) table.log.unshift(`🚪 Không đủ Linh Thạch, rời bàn: ${kicked.join(', ')}`);
                await afterAction(table);
                return interaction.editReply(render(table));
            }
            case 'end':
                if (!seat) return reply('Chỉ người ngồi trong bàn mới giải tán được.');
                if (table.mode === 'chung' && userId !== table.hostId) return reply('Chỉ chủ bàn 👑 mới giải tán được. Bạn có thể bấm **Rời bàn**.');
                return interaction.editReply(closeTable(table, `${seat.name} đã giải tán bàn`));
            default:
                return reply('Hành động không hợp lệ.');
        }

        armTimer(table);
        return interaction.editReply(render(table));
    });
}

module.exports = {
    commands: [pokerCommand],
    interactions: {
        pk: handlePokerButtons,
    },
    // Liệt kê bàn đang mở trong kênh (cho /banchoi)
    listRooms: (channelId) => [...tables.values()]
        .filter((t) => t.message?.channelId === channelId)
        .map((t) => {
            const host = t.players.find((p) => p.id === t.hostId);
            const joinable = t.mode === 'chung' && t.players.length < T.MAX_SEATS;
            return {
                game: '♠️ Poker',
                title: `Bàn ${t.mode === 'solo' ? 'solo với máy' : 'chung'} của ${host?.name || 'đạo hữu'}`,
                detail: `💎 ${fmt(t.bet)}/ante · 👥 ${t.players.length}/${T.MAX_SEATS} · ${isPlaying(t) ? `đang chơi ván #${t.handNo}` : 'đang chờ'}`,
                joinable,
                url: t.message?.url,
            };
        }),
    // Bot tắt/khởi động lại: đóng mọi bàn và trả chip (kể cả phần đã bỏ vào pot của ván dở)
    onShutdown: () => Promise.all([...tables.values()].map(async (table) => {
        await editTableMessage(table, closeTable(table, 'Bot khởi động lại để bảo trì — ván dở được huỷ, chip được hoàn lại Linh Thạch'));
        await table.cashOutPromise;
    })),
    // xuất cho test
    _internal: { render, tables },
};
