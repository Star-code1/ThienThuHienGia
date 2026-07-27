const { CLASSES } = require('../constants');
const Event = require('../models/Event');
const { upsertAttendance, refreshEventMessage } = require('../utils');

async function handleSelectClass(interaction, client) {
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

  await refreshEventMessage(client, eventMessageId, eventMessageId);
  await interaction.editReply(`✅ Đã điểm danh với class **${classObj?.label || chosen}**!`);
}

module.exports = handleSelectClass;
