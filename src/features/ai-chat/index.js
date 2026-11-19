/**
 * Tiểu Hàn (/tieuhan) + phần dùng chung của phiên trò chuyện AI:
 * nút Hỏi tiếp / Phiên mới, form hỏi tiếp, và reply vào tin của bot để hỏi tiếp.
 */
const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    Events,
} = require('discord.js');
const { PERSONAS, runTurn, answerFromEmbedDescription } = require('./chatFlow');
const sessions = require('../../services/aiSessionService');
const { getDisplayName, resolveUserMentions } = require('../../shared/utils/nameHelper');

const keyFor = (ctx, userId, bot) => ({ guildId: ctx.guildId || 'dm', channelId: ctx.channelId, userId, bot });
const askerOf = (ctx, user) => ({ name: getDisplayName(ctx), avatarURL: user.displayAvatarURL() });

/** Hỏi từ slash command hoặc form (interaction đã/chưa defer đều được). */
async function askFromInteraction(bot, interaction, rawQuestion) {
    const question = resolveUserMentions(interaction, rawQuestion).trim();
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
    await runTurn({
        bot,
        key: keyFor(interaction, interaction.user.id, bot),
        question,
        asker: askerOf(interaction, interaction.user),
        send: (payload) => interaction.editReply(payload),
        edit: (payload) => interaction.editReply(payload),
    });
}

const tieuhanCommand = {
    data: new SlashCommandBuilder()
        .setName('tieuhan')
        .setDescription('❄️ Hỏi Tiểu Hàn — trợ lý wiki Nghịch Thủy Hàn (build, trang bị, phó bản, nhiệm vụ…)')
        .addStringOption((o) => o.setName('cau_hoi').setDescription('Điều muốn hỏi về game').setRequired(true).setMaxLength(1000)),
    async execute(interaction) {
        await askFromInteraction('tieuhan', interaction, interaction.options.getString('cau_hoi'));
    },
};

function buildAskModal(bot) {
    return new ModalBuilder()
        .setCustomId(`ai:ask:${bot}`)
        .setTitle(`Hỏi tiếp ${PERSONAS[bot].name}`)
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('cau_hoi')
                .setLabel('Câu hỏi')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true)
                .setPlaceholder('Hỏi tiếp, AI nhớ những gì đã trao đổi trong phiên này')
        ));
}

/** customId: ai:more|reset:<bot>:<ownerId>  •  ai:ask:<bot> (form) */
async function handleAiInteraction(interaction) {
    const [, action, bot, ownerId] = interaction.customId.split(':');
    if (!PERSONAS[bot]) return;
    const p = PERSONAS[bot];

    if (action === 'ask' && interaction.isModalSubmit()) {
        return askFromInteraction(bot, interaction, interaction.fields.getTextInputValue('cau_hoi'));
    }

    const notOwner = ownerId && ownerId !== interaction.user.id;
    if (action === 'more') {
        if (notOwner) {
            return interaction.reply({
                content: `💡 Đây là phiên của người khác. Bạn có thể **reply** vào tin này để hỏi tiếp theo phiên của mình, hoặc dùng \`${p.command}\`.`,
                flags: 64,
            });
        }
        return interaction.showModal(buildAskModal(bot));
    }

    if (action === 'reset') {
        if (notOwner) return interaction.reply({ content: 'Chỉ người hỏi mới xóa được phiên này.', flags: 64 });
        await sessions.resetSession(keyFor(interaction, interaction.user.id, bot));
        return interaction.reply({ content: `🧹 Đã bắt đầu phiên mới với **${p.name}** — câu hỏi tiếp theo sẽ không nhớ nội dung cũ.`, flags: 64 });
    }
}

/** Reply vào câu trả lời của bot → hỏi tiếp trong phiên. */
const onReplyToAi = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message.guild || message.author.bot || !message.reference?.messageId) return;
        const rawQuestion = (message.content || '').trim();
        if (!rawQuestion) return;

        const refId = message.reference.messageId;
        const source = await sessions.findByMessageId(refId).catch(() => null);
        if (!source) return;

        const bot = source.bot;
        const key = keyFor(message, message.author.id, bot);

        // Người khác reply vào câu trả lời → mở phiên riêng, mang theo câu trả lời đó làm ngữ cảnh
        if (source.userId !== message.author.id) {
            const own = await sessions.getSession(key).catch(() => null);
            if (!own?.messageIds?.includes(refId)) {
                const ref = await message.channel.messages.fetch(refId).catch(() => null);
                const answer = answerFromEmbedDescription(ref?.embeds?.[0]?.description);
                if (answer) await sessions.seedAssistantMessage(key, answer).catch(() => {});
            }
        }

        let sent = null;
        await message.channel.sendTyping().catch(() => {});
        await runTurn({
            bot,
            key,
            question: resolveUserMentions(message, rawQuestion),
            asker: { name: getDisplayName(message), avatarURL: message.author.displayAvatarURL() },
            send: async (payload) => (sent = await message.reply({ ...payload, allowedMentions: { repliedUser: false } })),
            edit: (payload) => sent.edit(payload),
        });
    },
};

module.exports = {
    commands: [tieuhanCommand],
    interactions: { ai: handleAiInteraction },
    events: [onReplyToAi],
    askFromInteraction,
};
