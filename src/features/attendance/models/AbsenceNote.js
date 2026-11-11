const mongoose = require('mongoose');

// Ghi chú của Đương Gia / Đường Chủ dành cho đệ tử vắng nhiều trong một tháng
const absenceNoteSchema = new mongoose.Schema({
  month: { type: String, required: true }, // 'YYYY-MM' (giờ Việt Nam)
  userId: { type: String, required: true },
  content: { type: String, required: true, maxlength: 500 },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now },
});

absenceNoteSchema.index({ month: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.AbsenceNote || mongoose.model('AbsenceNote', absenceNoteSchema);
