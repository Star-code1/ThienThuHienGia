const mongoose = require('mongoose');

// Role tạm do bot cấp cho người đã vote sự kiện; hết hạn thì bot tự gỡ.
// Chỉ ghi nhận khi chính bot là bên cấp role (không đụng role người ta đã có sẵn).
const eventRoleGrantSchema = new mongoose.Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  roleId: { type: String, required: true },
  kind: { type: String, required: true },      // 'bangchien' | 'scrim'
  eventId: { type: String, required: true },   // messageId của sự kiện đã vote
  expiresAt: { type: Date, required: true },
  grantedAt: { type: Date, default: Date.now },
});

eventRoleGrantSchema.index({ guildId: 1, userId: 1, roleId: 1 }, { unique: true });
eventRoleGrantSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('EventRoleGrant', eventRoleGrantSchema);
