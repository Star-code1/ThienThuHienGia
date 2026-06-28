require('dotenv').config();
const { REST, Routes } = require('discord.js');
const commands = require('./src/commands');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Đang đăng ký slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Đăng ký slash commands thành công!');
  } catch (err) {
    console.error('❌ Lỗi đăng ký commands:', err);
  }
})();
