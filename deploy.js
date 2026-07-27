require('dotenv').config();
const { REST, Routes } = require('discord.js');
const client = require('./src/core/client');
const { loadFeatures, getAllCommandsJSON } = require('./src/core/loader');

// Load features để lấy commands
loadFeatures(client);
const commands = getAllCommandsJSON(client);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Đang đăng ký slash commands...');
    console.log('CLIENT_ID:', process.env.CLIENT_ID);
    console.log('TOKEN:', process.env.DISCORD_TOKEN ? 'OK' : 'MISSING');
    console.log('Commands:', commands.length);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Đăng ký slash commands thành công!');
  } catch (err) {
    console.error('❌ Lỗi đăng ký commands:', err);
  }
})();
