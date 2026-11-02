const { SlashCommandBuilder, PermissionFlagsBits, Events } = require('discord.js');
const interactions = require('./interactions');
const { parseRoleChoiceLines, reactionMatchesEmoji } = require('./utils');

const command = {
  data: new SlashCommandBuilder()
    .setName('tao-role-vote')
    .setDescription('Tạo tin nhắn cho phép thành viên nhận role bằng reaction')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  execute(interaction) {
    return interactions.start(interaction);
  },
};

async function handleReaction(reaction, user, addRole) {
  if (user.bot || !reaction.message.guild) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    if (reaction.message.author.id !== reaction.message.client.user.id) return;

    const embed = reaction.message.embeds.find((item) =>
      item.footer?.text?.startsWith('reaction-role:v1')
    );
    const choice = parseRoleChoiceLines(embed).find((item) =>
      reactionMatchesEmoji(reaction.emoji, item)
    );
    if (!choice) return;

    const guild = reaction.message.guild;
    const role = guild.roles.cache.get(choice.roleId);
    if (!role) {
      console.warn(`Role ${choice.roleId} trong bảng chọn ${reaction.message.id} không còn tồn tại.`);
      return;
    }

    const member = await guild.members.fetch(user.id);
    if (addRole) {
      await member.roles.add(role, 'Thành viên chọn role bằng reaction');
    } else {
      await member.roles.remove(role, 'Thành viên bỏ reaction chọn role');
    }
  } catch (error) {
    console.error(`Lỗi ${addRole ? 'cấp' : 'gỡ'} role từ reaction:`, error);
  }
}

module.exports = {
  commands: [command],
  interactions: {
    rr_channel: interactions.handle,
    rr_description: interactions.handle,
    rr_options: interactions.handle,
    rr_roles_modal: interactions.handle,
    rr_cancel: interactions.handle,
    rr_confirm: interactions.handle,
  },
  events: [
    {
      name: Events.MessageReactionAdd,
      execute(reaction, user) {
        return handleReaction(reaction, user, true);
      },
    },
    {
      name: Events.MessageReactionRemove,
      execute(reaction, user) {
        return handleReaction(reaction, user, false);
      },
    },
  ],
};
