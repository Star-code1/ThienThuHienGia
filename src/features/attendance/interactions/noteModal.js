const Event = require('../models/Event');
const Note = require('../models/Note');

async function handleNoteModal(interaction) {
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
}

module.exports = handleNoteModal;
