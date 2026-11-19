const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Link phòng Voice của từng cánh quân trong trận Bang Chiến.
 * Bấm nút là vào thẳng phòng, không phải tìm.
 */
const VOICE_CHANNELS = [
  { key: 'push', label: 'PUSH', emoji: '⚔️', url: 'https://discord.gg/GVYBgr6E2' },
  { key: 'mid', label: 'MID', emoji: '🎯', url: 'https://discord.gg/bTwb2EYJS' },
  { key: 'def-trai', label: 'DEF TRÁI', emoji: '🛡️', url: 'https://discord.gg/unYKZCmpn' },
  { key: 'def-phai', label: 'DEF PHẢI', emoji: '🛡️', url: 'https://discord.gg/baWe5NSwA' },
];

/** Dòng text liệt kê link voice (dùng trong embed / prompt AI) */
function voiceLinksText() {
  return VOICE_CHANNELS.map((v) => `${v.emoji} **${v.label}** — ${v.url}`).join('\n');
}

/** Hàng nút Link mở thẳng phòng voice */
function buildVoiceButtonsRow() {
  return new ActionRowBuilder().addComponents(
    VOICE_CHANNELS.map((v) =>
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(v.url).setLabel(v.label).setEmoji(v.emoji)
    )
  );
}

module.exports = { VOICE_CHANNELS, voiceLinksText, buildVoiceButtonsRow };
