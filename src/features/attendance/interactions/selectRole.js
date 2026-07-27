const { ROLES } = require('../constants');
const Event = require('../models/Event');
const Attendance = require('../models/Attendance');
const { upsertAttendance, refreshEventMessage } = require('../utils');

async function handleSelectRole(interaction, client) {
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

  await refreshEventMessage(client, eventMessageId, eventMessageId);
  await interaction.editReply(`✅ Đã chọn nhiệm vụ **${roleObj?.emoji || ''} ${roleObj?.label || chosen}**!`);
}

module.exports = handleSelectRole;
