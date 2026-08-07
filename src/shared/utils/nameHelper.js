/**
 * Lấy biệt danh server (Server Nickname / DisplayName) của người dùng
 * @param {import('discord.js').Interaction | import('discord.js').Message} context 
 * @param {import('discord.js').User} [targetUser] 
 * @returns {string}
 */
function getDisplayName(context, targetUser = null) {
    if (targetUser && context.guild) {
        const member = context.guild.members.cache.get(targetUser.id);
        if (member?.displayName) return member.displayName;
        if (targetUser.globalName) return targetUser.globalName;
        if (targetUser.username) return targetUser.username;
    }

    if (context.member?.displayName) {
        return context.member.displayName;
    }
    if (context.user?.globalName) {
        return context.user.globalName;
    }
    if (context.user?.username) {
        return context.user.username;
    }
    if (context.author?.globalName) {
        return context.author.globalName;
    }
    if (context.author?.username) {
        return context.author.username;
    }
    return 'Đạo hữu';
}

/**
 * Chuyển đổi các thẻ tag ID mention dạng <@123456789> hoặc <@!123456789> thành biệt danh server (@BiệtDanh)
 * @param {import('discord.js').Interaction | import('discord.js').Message} context 
 * @param {string} [inputContent] 
 * @returns {string}
 */
function resolveUserMentions(context, inputContent = null) {
    let content = inputContent !== null ? inputContent : (context.content || '');
    if (!content) return content;

    const guild = context.guild;

    // 1. Thay thế từ danh sách user được mention trong context
    if (context.mentions && context.mentions.users && context.mentions.users.size > 0) {
        context.mentions.users.forEach((user, userId) => {
            const member = guild?.members?.cache?.get(userId) || context.mentions.members?.get(userId);
            const displayName = member?.displayName || user.globalName || user.username;
            const regex = new RegExp(`<@!?${userId}>`, 'g');
            content = content.replace(regex, `@${displayName}`);
        });
    }

    // 2. Fallback thay thế bất kỳ thẻ <@ID> hoặc <@!ID> còn lại trong cache
    const userRegex = /<@!?(\d+)>/g;
    content = content.replace(userRegex, (match, userId) => {
        if (guild) {
            const member = guild.members.cache.get(userId);
            if (member?.displayName) return `@${member.displayName}`;
        }
        const user = context.client?.users?.cache.get(userId);
        if (user?.globalName || user?.username) return `@${user.globalName || user.username}`;
        return match;
    });

    // 3. Thay thế role mention <@&ID>
    const roleRegex = /<@&(\d+)>/g;
    content = content.replace(roleRegex, (match, roleId) => {
        if (guild) {
            const role = guild.roles.cache.get(roleId);
            if (role?.name) return `@${role.name}`;
        }
        return match;
    });

    return content;
}

module.exports = {
    getDisplayName,
    resolveUserMentions
};
