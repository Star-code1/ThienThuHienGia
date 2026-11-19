const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const svc = require('../src/services/notificationService');

const SNAP = path.join(__dirname, 'notificationEmbeds.snap.json');
const event = { title: 'Bang Chiến', date: '2026-11-10T00:00:00', time: '20h30' };
const strip = (e) => { const j = e.toJSON(); delete j.timestamp; return j; };

const cases = {
  unvoted: () => svc.buildUnvotedReminderEmbed({ event, milestoneHours: 12 }),
  soon: () => svc.buildGameStartingSoonEmbed({ event, minutesLeft: 30 }),
  tentative: () => svc.buildTentativeConfirmEmbed({ event, hoursLeft: 24 }),
  unassigned: () => svc.buildUnassignedNoticeEmbed({ event }),
  lineup: () => svc.buildLineupAssignmentEmbed({
    event, divisionName: 'Đoàn 1', divisionNote: 'dn', teamName: 'Team A', teamNote: 'tn',
    slotIndex: 1, roleName: 'Tank', note: 'ghi chú', skills: [{ name: 'Kỹ năng 1' }],
    teammates: [{ userId: 'u1', slotIndex: 0, className: 'Thiết Y', roleName: 'Tank', note: 'x' },
                { userId: 'u2', slotIndex: 1, className: 'Huyền Cơ' }, { slotIndex: 2 }],
    currentUserId: 'u2', isUpdate: true,
  }),
};

test('getEventDateTime', () => {
  const d = svc.getEventDateTime(event);
  assert.strictEqual(d.getHours(), 20);
  assert.strictEqual(d.getMinutes(), 30);
  assert.strictEqual(svc.getEventDateTime({}), null);
  assert.strictEqual(svc.getEventDateTime({ date: '2026-11-10T00:00:00' }).getHours(), 20);
});

test('embed builders khớp snapshot', () => {
  const actual = Object.fromEntries(Object.entries(cases).map(([k, f]) => [k, strip(f())]));
  if (!fs.existsSync(SNAP)) fs.writeFileSync(SNAP, JSON.stringify(actual, null, 2));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(fs.readFileSync(SNAP, 'utf8')));
});

test('tin nhắc 30 phút có đủ link voice + nút bấm', () => {
  const { VOICE_CHANNELS, buildVoiceButtonsRow } = require('../src/shared/voiceChannels');
  const json = svc.buildGameStartingSoonEmbed({ event, minutesLeft: 30 }).toJSON();
  const voiceField = json.fields.find((f) => f.name.includes('Voice'));
  for (const v of VOICE_CHANNELS) assert.ok(voiceField.value.includes(v.url), v.label);
  const row = buildVoiceButtonsRow().toJSON();
  assert.deepStrictEqual(row.components.map((b) => b.url), VOICE_CHANNELS.map((v) => v.url));
  assert.ok(row.components.every((b) => b.style === 5)); // ButtonStyle.Link
});
