// 1. Nạp dotenv LÊN ĐẦU FILE
require('dotenv').config();

const express = require("express");
const dns = require('dns');
const { Client, GatewayIntentBits, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { Event, Attendance, Note } = require('./src/models');
const { CLASSES, ROLES, buildEventMessage } = require('./src/builder');

// --- Web Server (Dùng giữ host live) ----------------------------------------
const app = express();
app.get("/", (req, res) => {
    res.send("Bot is running");
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Web server listening on port ${PORT}`);
});

// Ép DNS Google (Nếu bị lỗi mạng trên VPS/Host hãy comment 2 dòng dưới lại)
try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (e) {
    console.warn("⚠️ Không thể đổi DNS Servers:", e.message);
}

// ── Khởi động client Discord ──────────────────────────────────────────────────
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// --- Khởi động Anti-Spam -----------------------------------------------------
require("./src/events/antiSpam")(client);

// ── Connect MongoDB ───────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Kết nối MongoDB thành công'))
  .catch(err => { 
      console.error('❌ MongoDB lỗi:', err); 
      process.exit(1); 
  });

// ── Helper: lấy attendees và rebuild message ──────────────────────────────────
async function refreshEventMessage(interaction, eventId, messageId) {
  const attendees = await Attendance.find({ eventId });
  const event = await Event.findOne({ messageId });
  if (!event) return;

  const payload = buildEventMessage({
    title:     event.title,
    date:      event.date ? event.date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—',
    time:      event.time,
    eventId:   messageId,
    attendees: attendees.map(a => ({
      displayName: a.displayName || a.username,
      className:   a.className   || '—',
      status:      a.status,
      role:        a.role || null,
    })),
  });

  try {
    const channel = await client.channels.fetch(event.channelId);
    // ✅ Đã thêm await ở đây
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(payload);
  } catch (e) {
    console.error("========== LỖI EDIT MESSAGE ==========");
    console.error(e);
    console.error("======================================");
  }
}

// ── Upsert attendance record ──────────────────────────────────────────────────
async function upsertAttendance(eventMessageId, user, member, update) {
  return Attendance.findOneAndUpdate(
    { eventId: eventMessageId, userId: user.id },
    {
      eventId: eventMessageId,
      userId: user.id,
      username: user.username,
      displayName:
        member?.displayName ||
        user.displayName ||
        user.globalName ||
        user.username,
      ...update,
      timestamp: new Date(),
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );
}

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

// ── Event: Client Ready ───────────────────────────────────────────────────────
client.once(Events.ClientReady, () => {
  console.log(`🤖 Bot đã online: ${client.user.tag}`);
});

// ── Event: Interaction Create ─────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
    try {

      // 1. Slash Command: /diemdanh
      if (interaction.isChatInputCommand() && interaction.commandName === 'diemdanh') {
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
        return;
      }

      // 2. Slash Command: /danhsach
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
        const lines = attendees.map(a => {
          const roleText = a.role ? ` | ${a.role}` : '';
          return `• **${a.displayName}** — ${a.className || '—'}${roleText} (${statusLabel(a.status)})`;
        });

        await interaction.editReply(
          `**${event.title}**\nTổng: ${attendees.length} người\n\n` +
          (lines.length ? lines.join('\n') : '_Chưa có ai điểm danh._')
        );
        return;
      }

      // 3. Slash Command: /xoa
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

      // 4. Slash Command: /ghichu
      if (interaction.isChatInputCommand() && interaction.commandName === 'ghichu') {
        await interaction.deferReply({ flags: 64 });

        const msgId = interaction.options.getString('message_id');
        const query = msgId ? { messageId: msgId } : { active: true };
        const event = await Event.findOne(query).sort({ createdAt: -1 });

        if (!event) {
          await interaction.editReply('❌ Không tìm thấy sự kiện nào.');
          return;
        }

        const notes = await Note.find({ eventId: event.messageId }).sort({ createdAt: 1 });

        if (notes.length === 0) {
          const emptyEmbed = new EmbedBuilder()
            .setColor(0xE8A317)
            .setTitle('📝 Ghi chú')
            .setDescription(`**${event.title}**\n\n> _Chưa có ghi chú nào._\n> _Bấm nút_ 📝 **Ghi chú** _trên bảng điểm danh để thêm._`)
            .setTimestamp();
          await interaction.editReply({ embeds: [emptyEmbed] });
          return;
        }

        const lines = notes.map((n, i) => {
          const time = n.createdAt ? n.createdAt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }) : '—';
          return `> **${i + 1}.** ${n.content}\n> ╰ 👤 _${n.displayName}_ • 🕐 _${time}_`;
        });

        const noteEmbed = new EmbedBuilder()
          .setColor(0xE8A317)
          .setTitle('📝 Tổng hợp ghi chú')
          .setDescription(
            `**${event.title}**\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            lines.join('\n\n') +
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
          )
          .setFooter({ text: `Tổng: ${notes.length} ghi chú` })
          .setTimestamp();

        await interaction.editReply({ embeds: [noteEmbed] });
        return;
      }

      // 5. Select Menu: Class
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

        await upsertAttendance(eventMessageId, interaction.user, interaction.member, {
          className: classObj?.label || chosen,
          status:    'present',
        });

        await refreshEventMessage(interaction, eventMessageId, eventMessageId);
        await interaction.editReply(`✅ Đã điểm danh với class **${classObj?.label || chosen}**!`);
        return;
      }

      // 6. Select Menu: Role
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_role:')) {
        await interaction.deferReply({ flags: 64 });

        const eventMessageId = interaction.customId.split(':')[1];
        const chosen = interaction.values[0];
        const roleObj = ROLES.find(r => r.value === chosen);

        const event = await Event.findOne({ messageId: eventMessageId, active: true });
        if (!event) {
          await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
          return;
        }

        const existing = await Attendance.findOne({ eventId: eventMessageId, userId: interaction.user.id });
        if (!existing || existing.status !== 'present') {
          await interaction.editReply('⚠️ Bạn cần **điểm danh class** trước khi chọn nhiệm vụ!');
          return;
        }

        await upsertAttendance(eventMessageId, interaction.user, interaction.member, {
          role: roleObj?.label || chosen,
        });

        await refreshEventMessage(interaction, eventMessageId, eventMessageId);
        await interaction.editReply(`✅ Đã chọn nhiệm vụ **${roleObj?.emoji || ''} ${roleObj?.label || chosen}**!`);
        return;
      }

      // 7. Buttons
      if (interaction.isButton()) {
        const [action, eventMessageId] = interaction.customId.split(':');

        // Mở Modal (Không được deferReply trước)
        if (action === 'btn_note') {
          const modal = new ModalBuilder()
            .setCustomId(`modal_note:${eventMessageId}`)
            .setTitle('📝 Thêm ghi chú');

          const noteInput = new TextInputBuilder()
            .setCustomId('note_content')
            .setLabel('Nội dung ghi chú')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Nhập ghi chú của bạn tại đây...')
            .setRequired(true)
            .setMaxLength(500);

          modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
          await interaction.showModal(modal);
          return;
        }

        await interaction.deferReply({ flags: 64 });

        const event = await Event.findOne({ messageId: eventMessageId, active: true });
        if (!event) {
          await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
          return;
        }

        if (action === 'btn_cancel') {
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

        await upsertAttendance(eventMessageId, interaction.user, interaction.member, { status, className: null });
        await refreshEventMessage(interaction, eventMessageId, eventMessageId);
        await interaction.editReply(`✅ Đã đánh dấu bạn là **${statusLabel(status)}**.`);
      }

      // 8. Modal Submit
      if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_note:')) {
        await interaction.deferReply({ flags: 64 });

        const eventMessageId = interaction.customId.split(':')[1];
        const content = interaction.fields.getTextInputValue('note_content');
        const displayName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;

        const event = await Event.findOne({ messageId: eventMessageId, active: true });
        if (!event) {
          await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
          return;
        }

        await Note.create({
          eventId: eventMessageId,
          userId: interaction.user.id,
          displayName,
          content,
        });

        await interaction.editReply(`📝 Đã thêm ghi chú:\n> ${content}`);
        return;
      }

    } catch (err) {
        console.error("❌ Catch Error tại InteractionHandler:", err);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply("Có lỗi xảy ra trong quá trình xử lý.").catch(() => {});
        } else {
            await interaction.reply({
                content: "Có lỗi xảy ra trong quá trình xử lý.",
                flags: 64
            }).catch(() => {});
        }
    }
});

// ── Global Error Handlers ─────────────────────────────────────────────────────
client.on("error", (err) => console.error("========== DISCORD CLIENT ERROR ==========\n", err));
client.on("warn", (info) => console.warn("[Discord Warning]", info));

process.on("unhandledRejection", (reason, promise) => {
  console.error("========== UNHANDLED REJECTION ==========\nReason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("========== UNCAUGHT EXCEPTION ==========\n", err);
});

// ── Login ─────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Discord login thành công."))
  .catch((err) => console.error("========== LOGIN ERROR ==========\n", err));