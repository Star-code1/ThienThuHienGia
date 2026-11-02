const { PermissionFlagsBits } = require('discord.js');

const MAX_ROLE_CHOICES = 20;
const MAX_DESCRIPTION_LENGTH = 1500;

function parseRoleChoices(input, guild, botMember) {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (lines.length === 0) {
    throw new Error('Vui lòng nhập ít nhất một lựa chọn role.');
  }
  if (lines.length > MAX_ROLE_CHOICES) {
    throw new Error(`Chỉ có thể tạo tối đa ${MAX_ROLE_CHOICES} lựa chọn role.`);
  }

  const choices = [];
  const seenEmojis = new Set();

  for (const line of lines) {
    const customEmoji = line.match(/^(<a?:[a-zA-Z0-9_]+:\d+>)\s*:\s*(.+)$/);
    const separatorIndex = customEmoji ? -1 : line.indexOf(':');
    const emoji = (customEmoji ? customEmoji[1] : line.slice(0, separatorIndex)).trim();
    const roleName = (customEmoji ? customEmoji[2] : line.slice(separatorIndex + 1)).trim();

    if (separatorIndex === 0 || (!customEmoji && separatorIndex < 0) || !emoji || !roleName) {
      throw new Error(`Dòng không đúng định dạng: "${line}". Dùng <emoji>:<tên role>.`);
    }

    const emojiKey = customEmoji
      ? `custom:${customEmoji[1].match(/:(\d+)>$/)[1]}`
      : `unicode:${emoji}`;

    if (seenEmojis.has(emojiKey)) {
      throw new Error(`Emoji ${emoji} đang được dùng cho nhiều role.`);
    }
    seenEmojis.add(emojiKey);

    const matchingRoles = guild.roles.cache.filter((role) => role.name === roleName);
    if (matchingRoles.size === 0) {
      throw new Error(`Không tìm thấy role có tên chính xác "${roleName}".`);
    }
    if (matchingRoles.size > 1) {
      throw new Error(`Có nhiều role tên "${roleName}". Hãy đổi tên để phân biệt trước.`);
    }

    const role = matchingRoles.first();
    if (role.id === guild.id || role.managed) {
      throw new Error(`Role "${roleName}" không thể được bot cấp.`);
    }
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || botMember.roles.highest.comparePositionTo(role) <= 0) {
      throw new Error(`Bot không có quyền quản lý role "${roleName}". Hãy kiểm tra quyền Manage Roles và thứ tự role.`);
    }

    choices.push({ emoji, emojiKey, roleId: role.id, roleName: role.name });
  }

  return choices;
}

function parseRoleChoiceLines(embed) {
  if (!embed || !embed.footer?.text?.startsWith('reaction-role:v1')) return [];

  return embed.fields
    .filter((field) => field.name.startsWith('Role '))
    .flatMap((field) => field.value.split('\n'))
    .map((line) => {
      const match = line.match(/^(.+?) → <@&(\d+)>$/);
      if (!match) return null;

      const emoji = match[1].trim();
      const customEmoji = emoji.match(/^<a?:[^:]+:(\d+)>$/);
      return {
        emoji,
        emojiId: customEmoji ? customEmoji[1] : null,
        roleId: match[2],
      };
    })
    .filter(Boolean);
}

function reactionMatchesEmoji(reactionEmoji, choice) {
  return choice.emojiId
    ? reactionEmoji.id === choice.emojiId
    : !reactionEmoji.id && reactionEmoji.name === choice.emoji;
}

module.exports = {
  MAX_DESCRIPTION_LENGTH,
  MAX_ROLE_CHOICES,
  parseRoleChoices,
  parseRoleChoiceLines,
  reactionMatchesEmoji,
};
