const {
    PermissionsBitField,
    EmbedBuilder
} = require("discord.js");

module.exports = (client) => {

    const cache = new Map();

    // =============================
    // Có thể chỉnh các thông số này
    // =============================

    const WINDOW = 2500;          // 2.5 giây
    const MESSAGE_LIMIT = 3;       // tối thiểu 3 tin
    const CHANNEL_LIMIT = 3;       // ở 3 kênh khác nhau

    function normalize(text) {
        return text
            .toLowerCase()
            .replace(/\s+/g, "")
            .replace(/[^\p{L}\p{N}]/gu, "");
    }

client.on("messageCreate", async (message) => {

    if (!message.guild) return;
    if (message.author.bot) return;

    // Bỏ qua Admin
    if (
        message.member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )
    ) return;

    const TRAP_CHANNEL_ID = "1530983844113813545";
    const LOG_CHANNEL_ID = "1438974225154183219";

    // Không phải kênh bẫy
    if (message.channel.id !== TRAP_CHANNEL_ID) return;

    console.log(`[TRAP] ${message.author.tag}`);

    const oneMinutesAgo = Date.now() - 1 * 60 * 1000;

    let deleted = 0;

    // Quét tất cả kênh text
    for (const [, channel] of message.guild.channels.cache) {

        if (!channel.isTextBased()) continue;

        try {

            const messages = await channel.messages.fetch({
                limit: 100
            });

            const targets = messages.filter(msg =>
                msg.author.id === message.author.id &&
                msg.createdTimestamp >= oneMinutesAgo
            );

            for (const msg of targets.values()) {

                try {
                    await msg.delete();
                    deleted++;
                } catch {}

            }

        } catch {}

    }

    // Gửi log
    try {

        const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setColor("Red")
            .setTitle("🚨 Kích hoạt kênh bẫy")

            .addFields(
                {
                    name: "👤 Người dùng",
                    value: `${message.author.tag}\n${message.author.id}`
                },
                {
                    name: "🗑 Đã xóa",
                    value: `${deleted} tin nhắn`,
                    inline: true
                },
                {
                    name: "🔨 Hành động",
                    value: "Ban khỏi server",
                    inline: true
                },
                {
                    name: "📍 Kênh bẫy",
                    value: `<#${TRAP_CHANNEL_ID}>`
                }
            )

            .setTimestamp();

        await logChannel.send({
            embeds: [embed]
        });

    } catch (err) {

        console.log(err);

    }

    // Ban
    try {

        await message.guild.members.ban(
            message.author.id,
            {
                reason: "Kích hoạt Anti Trap",
                deleteMessageSeconds: 0
            }
        );

    } catch (err) {

        console.log(err);

    }

});

};