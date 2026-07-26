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

        // Bỏ qua admin
        if (
            message.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) return;

        const now = Date.now();
        const uid = message.author.id;

        if (!cache.has(uid))
            cache.set(uid, []);

        const history = cache.get(uid);

        history.push({
            id: message.id,
            channel: message.channel.id,
            content: normalize(message.content),
            created: now
        });

        const recent = history.filter(
            x => now - x.created <= WINDOW
        );

        cache.set(uid, recent);

        const same = recent.filter(
            x => x.content === normalize(message.content)
        );

        const channels = new Set(
            same.map(x => x.channel)
        );

        if (
            same.length >= MESSAGE_LIMIT &&
            channels.size >= CHANNEL_LIMIT
        ) {

            console.log(
                `[ANTI-SPAM] ${message.author.tag}`
            );

            // Timeout ngay nếu có quyền
            try {

                await message.member.timeout(
                    60 * 60 * 1000,
                    "Anti Spam"
                );

            } catch {}

            // Xóa toàn bộ tin

            for (const msg of same) {

                try {

                    const channel =
                        await client.channels.fetch(msg.channel);

                    const m =
                        await channel.messages.fetch(msg.id);

                    await m.delete();

                } catch {}

            }

            // Log

            try {

                const LOG_CHANNEL_ID = "1438974225154183219";

                const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);

                const embed = new EmbedBuilder()
                    .setColor("Red")
                    .setTitle("🚨 Anti Spam")

                    .addFields(
                        {
                            name: "Người dùng",
                            value:
`${message.author.tag}
${message.author.id}`
                        },
                        {
                            name: "Tin nhắn",
                            value: `${same.length}`,
                            inline: true
                        },
                        {
                            name: "Kênh",
                            value: `${channels.size}`,
                            inline: true
                        }
                    )
                    .setTimestamp();

                await logChannel.send({
                    embeds: [embed]
                });

            } catch (e) {}

            // Ban

            try {

                await message.guild.members.ban(
                    message.author.id,
                    {
                        deleteMessageSeconds: 0,
                        reason: "Spam nhiều kênh"
                    }
                );

            } catch (err) {

                console.log(err);

            }

            cache.delete(uid);

        }

    });

};