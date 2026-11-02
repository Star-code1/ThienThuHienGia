const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { randomUUID } = require('crypto');
const {
  MAX_DESCRIPTION_LENGTH,
  parseRoleChoices,
} = require('./utils');

const SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_TITLE_LENGTH = 256;
const sessions = new Map();

function createSession(interaction) {
  const id = randomUUID();
  const session = {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  session.timeout = setTimeout(() => sessions.delete(id), SESSION_TTL_MS);
  session.timeout.unref?.();
  sessions.set(id, session);
  return id;
}

function getSession(interaction, id) {
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) clearSession(id);
    return null;
  }
  if (session.userId !== interaction.user.id || session.guildId !== interaction.guildId) {
    return null;
  }
  return session;
}

function clearSession(id) {
  const session = sessions.get(id);
  if (session) clearTimeout(session.timeout);
  sessions.delete(id);
}

function cancelRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr_cancel:${id}`)
      .setLabel('Hủy')
      .setStyle(ButtonStyle.Secondary)
  );
}

function detailsModal(id) {
  return new ModalBuilder()
    .setCustomId(`rr_description:${id}`)
    .setTitle('Thông tin bảng chọn role')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Tiêu đề')
          .setPlaceholder('Chọn Phái')
          .setMaxLength(MAX_TITLE_LENGTH)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Lời nhắn')
          .setPlaceholder('Kêu gọi mọi người chọn một phái để sát cánh cùng nhau.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MAX_DESCRIPTION_LENGTH)
          .setRequired(true)
      )
    );
}

function rolesModal(id) {
  return new ModalBuilder()
    .setCustomId(`rr_roles_modal:${id}`)
    .setTitle('Các role có thể chọn')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('choices')
          .setLabel('Mỗi dòng: emoji hoặc tên emoji:tên role')
          .setPlaceholder('😀:Hiền triết\n🎮:Game thủ\nemoji_ten:Thần Tướng')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true)
      )
    );
}

function buildPreviewEmbed(session) {
  const choices = session.choices
    .map((choice) => `${choice.emoji} : <@&${choice.roleId}>`)
    .join('\n');

  return new EmbedBuilder()
    .setColor('#7289DA')
    .setTitle(session.title)
    .setDescription(`${session.description}\n\n${choices}`);
}

function previewButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rr_confirm:${id}`)
      .setLabel('Xác nhận và gửi')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rr_cancel:${id}`)
      .setLabel('Hủy')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function handleReactionRoleInteraction(interaction) {
  const [action, sessionId] = interaction.customId.split(':');

  if (action === 'rr_channel') {
    const session = getSession(interaction, sessionId);
    if (!session) {
      await interaction.reply({ content: 'Phiên tạo role đã hết hạn hoặc không thuộc về bạn.', ephemeral: true });
      return;
    }

    session.channelId = interaction.values[0];
    await interaction.showModal(detailsModal(sessionId));
    return;
  }

  if (action === 'rr_description') {
    const session = getSession(interaction, sessionId);
    if (!session) {
      await interaction.reply({ content: 'Phiên tạo role đã hết hạn hoặc không thuộc về bạn.', ephemeral: true });
      return;
    }

    session.title = interaction.fields.getTextInputValue('title').trim();
    session.description = interaction.fields.getTextInputValue('description').trim();
    if (!session.title || session.title.length > MAX_TITLE_LENGTH) {
      await interaction.reply({ content: `Tiêu đề phải có từ 1 đến ${MAX_TITLE_LENGTH} ký tự.`, ephemeral: true });
      return;
    }
    if (!session.description || session.description.length > MAX_DESCRIPTION_LENGTH) {
      await interaction.reply({ content: `Mô tả phải có từ 1 đến ${MAX_DESCRIPTION_LENGTH} ký tự.`, ephemeral: true });
      return;
    }

    await interaction.reply({
      content: 'Tiếp theo, nhập mỗi lựa chọn một dòng theo định dạng **emoji:tên role**. Emoji custom có thể nhập bằng tên.',
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rr_options:${sessionId}`)
            .setLabel('Nhập danh sách role')
            .setStyle(ButtonStyle.Primary),
          ...cancelRow(sessionId).components
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (action === 'rr_options') {
    if (!getSession(interaction, sessionId)) {
      await interaction.reply({ content: 'Phiên tạo role đã hết hạn hoặc không thuộc về bạn.', ephemeral: true });
      return;
    }

    await interaction.showModal(rolesModal(sessionId));
    return;
  }

  if (action === 'rr_roles_modal') {
    const session = getSession(interaction, sessionId);
    if (!session) {
      await interaction.reply({ content: 'Phiên tạo role đã hết hạn hoặc không thuộc về bạn.', ephemeral: true });
      return;
    }

    try {
      const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(interaction.client.user.id);
      session.choices = parseRoleChoices(
        interaction.fields.getTextInputValue('choices'),
        interaction.guild,
        botMember
      );
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
      return;
    }

    await interaction.reply({
      content: `Xem trước tin nhắn trong <#${session.channelId}>. Nhấn xác nhận để đăng và bật reaction.`,
      embeds: [buildPreviewEmbed(session)],
      components: [previewButtons(sessionId)],
      ephemeral: true,
    });
    return;
  }

  if (action === 'rr_cancel') {
    clearSession(sessionId);
    await interaction.update({ content: 'Đã hủy tạo bảng chọn role.', embeds: [], components: [] });
    return;
  }

  if (action === 'rr_confirm') {
    const session = getSession(interaction, sessionId);
    if (!session) {
      await interaction.update({ content: 'Phiên tạo role đã hết hạn hoặc không thuộc về bạn.', embeds: [], components: [] });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      clearSession(sessionId);
      await interaction.update({ content: 'Bạn cần quyền **Manage Roles** để đăng bảng chọn role.', embeds: [], components: [] });
      return;
    }

    await interaction.deferUpdate();

    let message;
    try {
      const channel = await interaction.guild.channels.fetch(session.channelId);
      const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(interaction.client.user.id);
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ReadMessageHistory,
      ];

      if (!channel || !channel.isTextBased() || !channel.permissionsFor(botMember)?.has(requiredPermissions)) {
        throw new Error('Bot thiếu quyền gửi embed hoặc reaction trong kênh đã chọn.');
      }

      session.choices = parseRoleChoices(
        session.choices.map((choice) => `${choice.emoji}:${choice.roleName}`).join('\n'),
        interaction.guild,
        botMember
      );

      message = await channel.send({
        embeds: [buildPreviewEmbed(session)],
        allowedMentions: { parse: [] },
      });

      for (const choice of session.choices) {
        try {
          await message.react(choice.emoji);
        } catch (error) {
          throw new Error(`Không thể thêm reaction ${choice.emoji}. Kiểm tra emoji và quyền sử dụng emoji của bot.`);
        }
      }

      clearSession(sessionId);
      await interaction.editReply({
        content: `✅ Đã đăng bảng chọn role tại <#${channel.id}>.`,
        embeds: [],
        components: [],
      });
    } catch (error) {
      if (message) {
        try {
          await message.delete();
        } catch (deleteError) {
          console.error('Không thể xóa tin nhắn bảng role tạo chưa hoàn tất:', deleteError);
        }
      }
      clearSession(sessionId);
      console.error('Lỗi tạo bảng chọn role:', error);
      await interaction.editReply({
        content: `❌ ${error.message || 'Không thể tạo bảng chọn role.'}`,
        embeds: [],
        components: [],
      });
    }
  }
}

module.exports = {
  start(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Lệnh này chỉ dùng trong server.', ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'Bạn cần quyền **Manage Roles** để tạo bảng chọn role.', ephemeral: true });
    }

    const sessionId = createSession(interaction);
    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId(`rr_channel:${sessionId}`)
      .setPlaceholder('Chọn kênh đăng tin nhắn role')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);
    return interaction.reply({
      content: 'Chọn kênh đăng tin nhắn, sau đó nhập tiêu đề, lời nhắn và danh sách role.',
      components: [
        new ActionRowBuilder().addComponents(channelMenu),
        cancelRow(sessionId),
      ],
      ephemeral: true,
    });
  },
  handle: handleReactionRoleInteraction,
};
