const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  userId: { type: String, required: true },
  displayName: { type: String },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

noteSchema.index({ eventId: 1 });

module.exports = mongoose.model('Note', noteSchema);
