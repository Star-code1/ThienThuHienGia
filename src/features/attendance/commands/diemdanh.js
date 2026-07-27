const { SlashCommandBuilder, ChannelType } = require('discord.js');
const Event = require('../models/Event');
const { buildEventMessage } = require('../builders/attendanceEmbed');

module.exports = {
  data: new SlashCommandBuilder()
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

  async execute(interaction, client) {
    await interaction.deferReply({ flags: 64 });

    const ten  = interaction.options.getString('ten');
    const ngay = interaction.options.getString('ngay');
    const gio  = interaction.options.getString('gio') || '20:00';
    const channel = interaction.options.getChannel('kenh') || interaction.channel;

    const title = `ĐIỂM DANH ${ten.toUpperCase()}`;

    let targetChannel;
    try {
      targetChannel = await client.channels.fetch(channel.id);
    } catch (e) {
      await interaction.editReply('❌ Bot không thể truy cập kênh. Kiểm tra lại quyền xem kênh của Bot.');
      return;
    }

    const msg = await targetChannel.send(
      buildEventMessage({ title, date: ngay, time: gio, eventId: 'TEMP', attendees: [] })
    );

    await Event.create({
      messageId:  msg.id,
      channelId:  channel.id,
      title,
      date:       new Date(ngay),
      time:       gio,
      createdBy:  interaction.user.id,
    });

    await msg.edit(
      buildEventMessage({ title, date: ngay, time: gio, eventId: msg.id, attendees: [] })
    );

    await interaction.editReply(`✅ Đã tạo sự kiện điểm danh: **${title}**`);
  },
};
