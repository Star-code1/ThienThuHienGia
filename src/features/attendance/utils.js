const Attendance = require('./models/Attendance');
const Event = require('./models/Event');
const { buildEventMessage } = require('./builders/attendanceEmbed');

/**
 * Upsert attendance record cho user
 */
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

/**
 * Lấy lại attendees và edit lại message sự kiện
 */
async function refreshEventMessage(client, eventId, messageId) {
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
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(payload);
  } catch (e) {
    console.error('========== LỖI EDIT MESSAGE ==========');
    console.error(e);
    console.error('======================================');
  }
}

module.exports = { upsertAttendance, refreshEventMessage };
