const { Events } = require('discord.js');
const { logCommandUsage } = require('../services/notificationService');

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
        try {
            // 1. Slash Commands & Context Menu Commands
            if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                try {
                    await command.execute(interaction, client);
                    // Ghi nhận log sử dụng lệnh thành công về NOTIFICATION_REPORT_CHANNEL_ID
                    await logCommandUsage(client, interaction);
                } catch (cmdErr) {
                    // Ghi nhận log sử dụng lệnh gặp lỗi
                    await logCommandUsage(client, interaction, cmdErr);
                    throw cmdErr;
                }
                return;
            }

            // 2. Buttons, Select Menus, Modals → match customId prefix
            const customId = interaction.customId;
            if (!customId) return;

            const prefix = customId.split(':')[0];
            const handler = client.interactions.get(prefix);

            if (handler) {
                await handler(interaction, client);
                return;
            }

        } catch (err) {
            console.error('❌ Catch Error tại InteractionHandler:', err);

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('Có lỗi xảy ra trong quá trình xử lý.').catch(() => {});
            } else {
                await interaction.reply({
                    content: 'Có lỗi xảy ra trong quá trình xử lý.',
                    flags: 64
                }).catch(() => {});
            }
        }
    },
};
