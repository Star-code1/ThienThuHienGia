const dns = require('dns');
const { Client, GatewayIntentBits, Collection } = require('discord.js');

// Ép DNS Google
try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
    console.warn('⚠️ Không thể đổi DNS Servers:', e.message);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Collections để loader đăng ký commands & interactions
client.commands = new Collection();
client.interactions = new Collection();

// Global Error Handlers
client.on('error', (err) => console.error('========== DISCORD CLIENT ERROR ==========\n', err));
client.on('warn', (info) => console.warn('[Discord Warning]', info));

module.exports = client;
