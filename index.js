const express = require("express");

const app = express();

app.get("/", (req, res) => {
    res.send("Bot is alive!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Web server running on ${PORT}`);
});

require('dotenv').config();
const dns = require('dns');

// Ép Node dùng DNS Google thay vì 127.0.0.1
dns.setServers(['8.8.8.8', '8.8.4.4']);
const { Client, GatewayIntentBits, Events } = require('discord.js');
const mongoose = require('mongoose');
const { Event, Attendance } = require('./src/models');
const { CLASSES, buildEventMessage } = require('./src/builder');

// ── Khởi động client ──────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ── Connect MongoDB ───────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Kết nối MongoDB thành công'))
  .catch(err => { console.error('❌ MongoDB lỗi:', err); process.exit(1); });

// ── Helper: lấy attendees và rebuild message ──────────────────────────────────
async function refreshEventMessage(interaction, eventId, messageId) {
  const attendees = await Attendance.find({ eventId });
  const event = await Event.findOne({ messageId });
  if (!event) return;

  const payload = buildEventMessage({
    title:     event.title,
    date:      event.date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }),
    time:      event.time,
    eventId:   messageId,
    attendees: attendees.map(a => ({
      displayName: a.displayName || a.username,
      className:   a.className   || '—',
      status:      a.status,
    })),
  });

  try {
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(payload);
  } catch (e) {
    console.error('Không thể edit message:', e.message);
  }
}

// ── Upsert attendance record ──────────────────────────────────────────────────
async function upsertAttendance(eventMessageId, user, update) {
  return Attendance.findOneAndUpdate(
    { eventId: eventMessageId, userId: user.id },
    {
      eventId:     eventMessageId,
      userId:      user.id,
      username:    user.username,
      displayName: user.displayName || user.globalName || user.username,
      ...update,
      timestamp:   new Date(),
    },
    { upsert: true, new: true }
  );
}

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`🤖 Bot đã online: ${client.user.tag}`);
});

// ── Slash Commands ─────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  // ── /diemdanh ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'diemdanh') {
    await interaction.deferReply({ flags: 64 });

    const ten  = interaction.options.getString('ten');
    const ngay = interaction.options.getString('ngay');
    const gio  = interaction.options.getString('gio') || '20:00';

    const title = `ĐIỂM DANH BANG CHIẾN — ${ten.toUpperCase()}`;

    // Gửi message vào channel điểm danh
    let channel;
    try {
      channel = await client.channels.fetch(process.env.CHANNEL_ID);
    } catch (e) {
      await interaction.editReply('❌ Bot không thể truy cập kênh. Kiểm tra:\n• CHANNEL_ID trong .env đúng chưa?\n• Bot đã có quyền xem kênh chưa?');
      return;
    }
    const msg = await channel.send(
      buildEventMessage({ title, date: ngay, time: gio, eventId: 'TEMP', attendees: [] })
    );

    // Lưu vào DB với messageId thật
    await Event.create({
      messageId:  msg.id,
      title,
      date:       new Date(ngay),
      time:       gio,
      createdBy:  interaction.user.id,
    });

    // Edit lại message với eventId đúng
    await msg.edit(
      buildEventMessage({ title, date: ngay, time: gio, eventId: msg.id, attendees: [] })
    );

    await interaction.editReply(`✅ Đã tạo sự kiện điểm danh: **${title}**`);
    return;
  }

  // ── /danhsach ──────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'danhsach') {
    await interaction.deferReply({ flags: 64 });

    const msgId = interaction.options.getString('message_id');
    const query = msgId ? { messageId: msgId } : { active: true };
    const event = await Event.findOne(query).sort({ createdAt: -1 });

    if (!event) {
      await interaction.editReply('❌ Không tìm thấy sự kiện nào.');
      return;
    }

    const attendees = await Attendance.find({ eventId: event.messageId });
    const lines = attendees.map(a =>
      `• **${a.displayName}** — ${a.className || '—'} (${statusLabel(a.status)})`
    );

    await interaction.editReply(
      `**${event.title}**\nTổng: ${attendees.length} người\n\n` +
      (lines.length ? lines.join('\n') : '_Chưa có ai điểm danh._')
    );
    return;
  }

  // ── /xoa ──────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'xoa') {
    await interaction.deferReply({ flags: 64 });

    if (!interaction.member.permissions.has('ManageMessages')) {
      await interaction.editReply('❌ Bạn không có quyền xoá sự kiện.');
      return;
    }

    const msgId = interaction.options.getString('message_id');
    await Event.findOneAndUpdate({ messageId: msgId }, { active: false });
    await interaction.editReply(`✅ Đã đóng sự kiện \`${msgId}\`.`);
    return;
  }

  // ── Select class ───────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_class:')) {
    await interaction.deferReply({ flags: 64 });

    const eventMessageId = interaction.customId.split(':')[1];
    const chosen = interaction.values[0];
    const classObj = CLASSES.find(c => c.value === chosen);

    const event = await Event.findOne({ messageId: eventMessageId, active: true });
    if (!event) {
      await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
      return;
    }

    await upsertAttendance(eventMessageId, interaction.user, {
      className: classObj?.label || chosen,
      status:    'present',
    });

    await refreshEventMessage(interaction, eventMessageId, eventMessageId);
    await interaction.editReply(`✅ Đã điểm danh với class **${classObj?.label || chosen}**!`);
    return;
  }

  // ── Buttons ────────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const [action, eventMessageId] = interaction.customId.split(':');
    await interaction.deferReply({ flags: 64 });

    const event = await Event.findOne({ messageId: eventMessageId, active: true });
    if (!event) {
      await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
      return;
    }

    if (action === 'btn_cancel') {
      // Huỷ điểm danh của người dùng
      await Attendance.findOneAndDelete({ eventId: eventMessageId, userId: interaction.user.id });
      await refreshEventMessage(interaction, eventMessageId, eventMessageId);
      await interaction.editReply('🔄 Đã huỷ điểm danh của bạn.');
      return;
    }

    const statusMap = {
      btn_bench:     'bench',
      btn_late:      'late',
      btn_tentative: 'tentative',
      btn_absent:    'absent',
    };

    const status = statusMap[action];
    if (!status) return;

    await upsertAttendance(eventMessageId, interaction.user, { status, className: null });
    await refreshEventMessage(interaction, eventMessageId, eventMessageId);
    await interaction.editReply(`✅ Đã đánh dấu bạn là **${statusLabel(status)}**.`);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusLabel(status) {
  const map = {
    present:   '✅ Có mặt',
    bench:     '🪑 Bench',
    late:      '⏰ Muộn',
    tentative: '⚖️ Dự kiến',
    absent:    '❌ Vắng',
  };
  return map[status] || status;
}

// ── Global error handler (tránh crash) ───────────────────────────────────────
client.on('error', err => console.error('❌ Discord client error:', err.message));
process.on('unhandledRejection', err => console.error('❌ Unhandled rejection:', err.message));

// ── Start ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);