const mongoose = require('mongoose');

// Schema lưu sự kiện điểm danh
const eventSchema = new mongoose.Schema({
  messageId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: true },
});

// Schema lưu điểm danh từng người
const attendanceSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  displayName: { type: String },
  className: { type: String },        // class đã chọn
  status: {
    type: String,
    enum: ['present', 'bench', 'late', 'tentative', 'absent'],
    default: 'present',
  },
  timestamp: { type: Date, default: Date.now },
});

attendanceSchema.index({ eventId: 1, userId: 1 }, { unique: true });

const Event = mongoose.model('Event', eventSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = { Event, Attendance };
