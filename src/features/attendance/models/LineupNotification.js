const mongoose = require('mongoose');

const lineupNotificationSchema = new mongoose.Schema({
  eventId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  messageId: { type: String, required: true },
  channelId: { type: String, default: null },
  divisionName: { type: String, default: '' },
  divisionNote: { type: String, default: '' },
  teamName: { type: String, default: '' },
  teamNote: { type: String, default: '' },
  slotIndex: { type: Number, default: 0 },
  roleName: { type: String, default: '' },
  note: { type: String, default: '' },
  skills: { type: Array, default: [] },
  skillsHash: { type: String, default: '' },
  teammatesHash: { type: String, default: '' },
  isAssigned: { type: Boolean, default: true },
  lastNotifiedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  strict: false,
});

lineupNotificationSchema.index({ eventId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('LineupNotification', lineupNotificationSchema);
