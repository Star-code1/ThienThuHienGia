const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Event = require('../models/Event');
const Attendance = require('../models/Attendance');
const { upsertAttendance, refreshEventMessage } = require('../utils');
const { statusLabel } = require('../../../shared/helpers');

const STATUS_MAP = {
  btn_bench:     'bench',
  btn_late:      'late',
  btn_tentative: 'tentative',
  btn_absent:    'absent',
};

/**
 * Handler cho nút Ghi chú — mở modal (KHÔNG deferReply)
 */
async function handleNoteButton(interaction) {
  const eventMessageId = interaction.customId.split(':')[1];

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
}

/**
 * Handler cho nút Huỷ điểm danh
 */
async function handleCancelButton(interaction, client) {
  await interaction.deferReply({ flags: 64 });

  const eventMessageId = interaction.customId.split(':')[1];

  const event = await Event.findOne({ messageId: eventMessageId, active: true });
  if (!event) {
    await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
    return;
  }

  await Attendance.findOneAndDelete({ eventId: eventMessageId, userId: interaction.user.id });
  await refreshEventMessage(client, eventMessageId, eventMessageId);
  await interaction.editReply('🔄 Đã huỷ điểm danh của bạn.');
}

/**
 * Handler cho các nút trạng thái (bench, late, tentative, absent)
 */
async function handleStatusButton(interaction, client) {
  await interaction.deferReply({ flags: 64 });

  const [action, eventMessageId] = interaction.customId.split(':');

  const event = await Event.findOne({ messageId: eventMessageId, active: true });
  if (!event) {
    await interaction.editReply('❌ Sự kiện không tồn tại hoặc đã đóng.');
    return;
  }

  const status = STATUS_MAP[action];
  if (!status) return;

  await upsertAttendance(eventMessageId, interaction.user, interaction.member, { status, className: null });
  await refreshEventMessage(client, eventMessageId, eventMessageId);
  await interaction.editReply(`✅ Đã đánh dấu bạn là **${statusLabel(status)}**.`);
}

module.exports = { handleNoteButton, handleCancelButton, handleStatusButton };
