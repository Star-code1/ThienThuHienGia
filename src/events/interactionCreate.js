const { Events } = require('discord.js');

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
        try {
            // 1. Slash Commands
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(interaction, client);
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
