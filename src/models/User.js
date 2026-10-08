const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    discordId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    username: {
      type: String,
      required: true
    },
    globalName: {
      type: String,
      default: ''
    },
    nickname: {
      type: String,
      default: ''
    },
    displayName: {
      type: String,
      default: ''
    },
    avatar: {
      type: String,
      default: ''
    },
    className: {
      type: String,
      default: 'Chưa rõ'
    },
    primaryRole: {
      type: String,
      default: 'Bang Chúng'
    },
    roles: [
      {
        type: String
      }
    ],
    roleNames: [
      {
        type: String
      }
    ],
    roleName: {
      type: String,
      default: 'Bang Chúng'
    },
    canEdit: {
      type: Boolean,
      default: false
    },
    inGuild: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: Date.now
    },
    joinedAt: {
      type: Date
    },
    lastSyncedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('User', userSchema);
