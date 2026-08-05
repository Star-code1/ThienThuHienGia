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

module.exports = {
    getDisplayName
};
