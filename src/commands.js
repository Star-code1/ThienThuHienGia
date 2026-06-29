const { SlashCommandBuilder, ChannelType } = require('discord.js');

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
    .addChannelOption(opt =>
      opt.setName('kenh').setDescription('Kênh gửi thông báo (mặc định: kênh hiện tại)').addChannelTypes(ChannelType.GuildText).setRequired(false)
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

  new SlashCommandBuilder()
    .setName('ghichu')
    .setDescription('Xem tổng hợp ghi chú của sự kiện')
    .addStringOption(opt =>
      opt.setName('message_id').setDescription('Message ID của sự kiện (mặc định: sự kiện mới nhất)').setRequired(false)
    ),
].map(c => c.toJSON());

module.exports = commands;
