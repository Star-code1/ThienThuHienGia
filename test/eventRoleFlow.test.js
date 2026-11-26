const test = require('node:test');
const assert = require('node:assert');
const Event = require('../src/features/attendance/models/Event');
const Attendance = require('../src/features/attendance/models/Attendance');
const EventRoleGrant = require('../src/features/attendance/models/EventRoleGrant');
const { EVENT_ROLES, syncEventRoles } = require('../src/services/eventRoleService');

const BC = EVENT_ROLES.find((r) => r.kind === 'bangchien');
const SC = EVENT_ROLES.find((r) => r.kind === 'scrim');

// ---- Discord giả ----
function makeEnv({ events, votes, grants = [], membersRoles = {}, editable = true }) {
  const state = { grants: [...grants], memberRoles: { ...membersRoles }, added: [], removed: [] };
  const roleOf = (id) => ({ id, name: 'r' + id, editable });
  const guild = {
    id: 'G1',
    roles: { cache: { get: roleOf }, fetch: async (id) => roleOf(id) },
    members: {
      fetch: async (uid) => {
        if (uid.startsWith('gone')) throw new Error('Unknown Member');
        const set = (state.memberRoles[uid] = state.memberRoles[uid] || new Set());
        return {
          roles: {
            cache: { has: (r) => set.has(r) },
            add: async (r) => { set.add(r); state.added.push([uid, r]); },
            remove: async (r) => { set.delete(r); state.removed.push([uid, r]); },
          },
        };
      },
    },
  };
  const client = { guilds: { cache: { get: () => guild } }, channels: { fetch: async () => ({ guild }) } };

  Event.findOne = (q) => ({ sort: async () => events.filter((e) => e.channelId === q.channelId).sort((a, b) => b.createdAt - a.createdAt)[0] || null });
  Attendance.find = async (q) => votes.filter((v) => v.eventId === q.eventId && q.status.$in.includes(v.status));
  EventRoleGrant.find = async (q) => state.grants.filter((g) => g.roleId === q.roleId || (q.expiresAt && g.expiresAt <= q.expiresAt.$lte));
  EventRoleGrant.deleteOne = async ({ _id }) => { state.grants = state.grants.filter((g) => g._id !== _id); };
  EventRoleGrant.updateOne = async ({ _id }, u) => { Object.assign(state.grants.find((g) => g._id === _id), u); };
  EventRoleGrant.findOneAndUpdate = async (f, u) => {
    state.grants = state.grants.filter((g) => !(g.userId === f.userId && g.roleId === f.roleId));
    state.grants.push({ _id: `${u.userId}:${u.roleId}`, ...u });
  };
  return { client, state };
}

const day = 24 * 3600 * 1000;
const ev = (channelId, id, offsetDays, createdAt) => ({ channelId, messageId: id, title: id, date: new Date(Date.now() + offsetDays * day), createdAt: new Date(createdAt) });

test('cấp role cho người vote sự kiện mới nhất, bỏ qua Vắng', async () => {
  const { client, state } = makeEnv({
    events: [ev(BC.channelId, 'old', 1, 1000), ev(BC.channelId, 'new', 1, 2000)],
    votes: [
      { eventId: 'new', userId: 'u1', status: 'present' },
      { eventId: 'new', userId: 'u2', status: 'tentative' },
      { eventId: 'new', userId: 'u3', status: 'absent' },
      { eventId: 'old', userId: 'u4', status: 'present' }, // chỉ vote sự kiện cũ
    ],
  });
  await syncEventRoles(client);
  assert.deepStrictEqual(state.added.map((a) => a[0]).sort(), ['u1', 'u2']);
  assert.ok(state.added.every((a) => a[1] === BC.roleId));
  assert.ok(state.grants.every((g) => g.expiresAt > new Date()));
});

test('Scrim dùng role và kênh riêng', async () => {
  const { client, state } = makeEnv({
    events: [ev(SC.channelId, 's1', 1, 1000)],
    votes: [{ eventId: 's1', userId: 'u1', status: 'late' }],
  });
  await syncEventRoles(client);
  assert.deepStrictEqual(state.added, [['u1', SC.roleId]]);
});

test('đổi sang Vắng hoặc sự kiện mới không vote -> bị gỡ role', async () => {
  const past = { _id: 'a', guildId: 'G1', userId: 'u1', roleId: BC.roleId, eventId: 'old', expiresAt: new Date(Date.now() + day) };
  const same = { _id: 'b', guildId: 'G1', userId: 'u2', roleId: BC.roleId, eventId: 'new', expiresAt: new Date(Date.now() + day) };
  const { client, state } = makeEnv({
    events: [ev(BC.channelId, 'old', -3, 1000), ev(BC.channelId, 'new', 1, 2000)],
    votes: [{ eventId: 'new', userId: 'u2', status: 'absent' }],
    grants: [past, same],
    membersRoles: { u1: new Set([BC.roleId]), u2: new Set([BC.roleId]) },
  });
  await syncEventRoles(client);
  assert.deepStrictEqual(state.removed.map((r) => r[0]).sort(), ['u1', 'u2']);
  assert.strictEqual(state.grants.length, 0);
});

test('role hết hạn bị gỡ dù không có sự kiện mới', async () => {
  const exp = { _id: 'x', guildId: 'G1', userId: 'u9', roleId: SC.roleId, eventId: 'e', expiresAt: new Date(Date.now() - 1000) };
  const { client, state } = makeEnv({ events: [], votes: [], grants: [exp], membersRoles: { u9: new Set([SC.roleId]) } });
  await syncEventRoles(client);
  assert.deepStrictEqual(state.removed, [['u9', SC.roleId]]);
});

test('không động vào role người dùng đã có sẵn (cấp tay)', async () => {
  const { client, state } = makeEnv({
    events: [ev(BC.channelId, 'new', 1, 2000)],
    votes: [{ eventId: 'new', userId: 'u1', status: 'present' }],
    membersRoles: { u1: new Set([BC.roleId]) },
  });
  await syncEventRoles(client);
  assert.strictEqual(state.added.length, 0);
  assert.strictEqual(state.grants.length, 0); // không ghi nhận -> sẽ không bị gỡ khi hết hạn
});

test('bot không đủ quyền với role -> không làm gì', async () => {
  const { client, state } = makeEnv({
    events: [ev(BC.channelId, 'new', 1, 2000)],
    votes: [{ eventId: 'new', userId: 'u1', status: 'present' }],
    editable: false,
  });
  await syncEventRoles(client);
  assert.strictEqual(state.added.length, 0);
});

test('sự kiện đã quá hạn (tuần trước) -> không cấp role', async () => {
  const { client, state } = makeEnv({
    events: [ev(BC.channelId, 'new', -10, 2000)],
    votes: [{ eventId: 'new', userId: 'u1', status: 'present' }],
  });
  await syncEventRoles(client);
  assert.strictEqual(state.added.length, 0);
});
