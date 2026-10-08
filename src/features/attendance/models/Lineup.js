const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  slotIndex: { type: Number, required: true },
  userId: { type: String, default: null },
  displayName: { type: String, default: '' },
  roleName: { type: String, default: '' },
  className: { type: String, default: '' },
  note: { type: String, default: '' },
  isChecked: { type: Boolean, default: false },
  skills: [{
    id: { type: String },
    name: { type: String },
    iconUrl: { type: String }
  }],
}, { _id: false, strict: false });

const teamSchema = new mongoose.Schema({
  teamName: { type: String, required: true },
  teamTag: { type: String, default: '' },
  slots: [slotSchema],
}, { _id: false, strict: false });

const divisionSchema = new mongoose.Schema({
  divisionName: { type: String, required: true },
  isCollapsed: { type: Boolean, default: false },
  teams: [teamSchema],
}, { _id: false, strict: false });

const lineupSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  title: { type: String, default: 'ĐỘI HÌNH BANG CHIẾN' },
  divisions: [divisionSchema],
  updatedBy: { type: String },
  updatedAt: { type: Date, default: Date.now },
}, { strict: false });

module.exports = mongoose.model('Lineup', lineupSchema);
