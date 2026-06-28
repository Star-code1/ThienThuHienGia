const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('diemdanh')
    .setDescription('Tạo sự kiện điểm danh bang chiến mới')
    .addStringOption(opt =>
      opt.setName('ten').setDescription('Tên sự kiện (vd: Bang Chiến 4/7)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('ngay').setDescription('Ngày (vd: 4 July 2026)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('gio').setDescription('Giờ (vd: 20:00)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('danhsach')
    .setDescription('Xem danh sách điểm danh của sự kiện')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message ID của sự kiện').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('xoa')
    .setDescription('[ADMIN] Xoá/đóng sự kiện điểm danh')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message ID của sự kiện').setRequired(true)
    ),
].map(c => c.toJSON());

module.exports = commands;
