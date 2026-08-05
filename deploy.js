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
    console.log('GUILD_ID:', process.env.GUILD_ID || 'Không có (Đăng ký Global)');
    console.log('TOKEN:', process.env.DISCORD_TOKEN ? 'OK' : 'MISSING');
    console.log('Commands count:', commands.length);

    if (process.env.GUILD_ID) {
      console.log('🚀 Đang đăng ký Guild Commands (Cập nhật TỨC THÌ cho Server)...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log('✅ Đăng ký Guild Commands thành công!');
    }

    console.log('🌐 Đang đăng ký Global Commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Đăng ký Global commands thành công!');
  } catch (err) {
    console.error('❌ Lỗi đăng ký commands:', err);
  }
})();
