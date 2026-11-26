const Event = require('../features/attendance/models/Event');
const Attendance = require('../features/attendance/models/Attendance');
const EventRoleGrant = require('../features/attendance/models/EventRoleGrant');

// Mỗi loại sự kiện: kênh đăng điểm danh -> role được cấp cho người đã vote
const EVENT_ROLES = [
  {
    kind: 'bangchien',
    label: 'Bang Chiến',
    channelId: process.env.BANGCHIEN_CHANNEL_ID || '1515709357856264212',
    roleId: process.env.BANGCHIEN_ROLE_ID || '1575392045629964328',
  },
  {
    kind: 'scrim',
    label: 'Scrim',
    channelId: process.env.SCRIM_CHANNEL_ID || '1523997619716751491',
    roleId: process.env.SCRIM_ROLE_ID || '1575391986519904277',
  },
];

// Vote "Vắng" không được cấp role; các trạng thái còn lại (tham gia/dự bị/trễ/chưa chắc) thì có
const VOTED_STATUSES = ['present', 'bench', 'late', 'tentative'];

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh = UTC+7 (không có giờ mùa hè)
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hạn role: hết Chủ nhật (23:59:59 giờ VN) của tuần chứa ngày diễn ra sự kiện.
 * Tuần tính từ Thứ 2 đến Chủ nhật. Trả về Date = 00:00 Thứ 2 tuần sau (giờ VN).
 */
function getWeekEndExpiry(eventDate) {
  const d = new Date(eventDate);
  if (isNaN(d.getTime())) return null;
  const vn = new Date(d.getTime() + VN_OFFSET_MS); // đọc các trường UTC = giờ VN
  const dow = vn.getUTCDay(); // 0 = Chủ nhật
  const daysToSunday = (7 - dow) % 7;
  const startOfDayVn = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
  return new Date(startOfDayVn + (daysToSunday + 1) * DAY_MS - VN_OFFSET_MS);
}

async function getGuild(client, channelId) {
  const allowed = process.env.ALLOWED_GUILD_ID;
  if (allowed) {
    const g = client.guilds.cache.get(allowed);
    if (g) return g;
  }
  const ch = await client.channels.fetch(channelId).catch(() => null);
  return ch && ch.guild ? ch.guild : null;
}

async function removeGrant(guild, grant, reason) {
  try {
    const member = await guild.members.fetch(grant.userId).catch(() => null);
    if (member && member.roles.cache.has(grant.roleId)) {
      await member.roles.remove(grant.roleId, reason);
    }
  } catch (err) {
    console.error(`[EventRole] Không gỡ được role ${grant.roleId} của ${grant.userId}:`, err.message);
    return false; // giữ lại bản ghi để lần quét sau thử lại
  }
  await EventRoleGrant.deleteOne({ _id: grant._id });
  return true;
}

/**
 * Đối soát một loại sự kiện: người vote ở sự kiện MỚI NHẤT của kênh được cấp role,
 * ai không còn đủ điều kiện (đổi sang Vắng, huỷ vote, sự kiện mới hơn mà không vote) bị gỡ.
 */
async function reconcileKind(client, cfg) {
  const guild = await getGuild(client, cfg.channelId);
  if (!guild) return;
  const role = guild.roles.cache.get(cfg.roleId) || (await guild.roles.fetch(cfg.roleId).catch(() => null));
  if (!role) {
    console.warn(`[EventRole] Không tìm thấy role ${cfg.roleId} (${cfg.label}).`);
    return;
  }
  if (!role.editable) {
    console.warn(`[EventRole] Bot không quản lý được role "${role.name}" (${cfg.label}): cần quyền Manage Roles và role bot phải cao hơn role này.`);
    return;
  }

  const latest = await Event.findOne({ channelId: cfg.channelId }).sort({ createdAt: -1 });
  const now = new Date();
  const expiresAt = latest ? getWeekEndExpiry(latest.date) : null;
  const eventValid = Boolean(latest && expiresAt && expiresAt > now);

  const grants = await EventRoleGrant.find({ guildId: guild.id, roleId: cfg.roleId });
  const grantByUser = new Map(grants.map((g) => [g.userId, g]));

  let voterIds = new Set();
  if (eventValid) {
    const votes = await Attendance.find({ eventId: latest.messageId, status: { $in: VOTED_STATUSES } }, 'userId');
    voterIds = new Set(votes.map((v) => v.userId));
  }

  // 1. Gỡ role của người không còn đủ điều kiện
  for (const g of grants) {
    if (!eventValid || !voterIds.has(g.userId) || g.eventId !== latest.messageId) {
      await removeGrant(guild, g, `Hết điều kiện role ${cfg.label}`);
    }
  }

  if (!eventValid) return;

  // 2. Cấp role cho người đã vote
  for (const userId of voterIds) {
    const existing = grantByUser.get(userId);
    if (existing && existing.eventId === latest.messageId) {
      if (existing.expiresAt.getTime() !== expiresAt.getTime()) {
        await EventRoleGrant.updateOne({ _id: existing._id }, { expiresAt });
      }
      continue;
    }
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) continue; // đã rời server
      if (member.roles.cache.has(cfg.roleId) && !existing) continue; // đã có role sẵn (cấp tay) -> không động vào
      if (!member.roles.cache.has(cfg.roleId)) {
        await member.roles.add(cfg.roleId, `Đã vote ${latest.title}`);
      }
      await EventRoleGrant.findOneAndUpdate(
        { guildId: guild.id, userId, roleId: cfg.roleId },
        { guildId: guild.id, userId, roleId: cfg.roleId, kind: cfg.kind, eventId: latest.messageId, expiresAt, grantedAt: now },
        { upsert: true }
      );
      console.log(`[EventRole] ✅ Cấp role ${cfg.label} cho ${userId} đến ${expiresAt.toISOString()}`);
    } catch (err) {
      console.error(`[EventRole] Không cấp được role ${cfg.label} cho ${userId}:`, err.message);
    }
  }
}

/** Gỡ role đã hết hạn (kể cả khi chưa có sự kiện mới). */
async function expireGrants(client) {
  const expired = await EventRoleGrant.find({ expiresAt: { $lte: new Date() } });
  if (!expired.length) return;
  const byRole = new Map(EVENT_ROLES.map((c) => [c.roleId, c]));
  for (const g of expired) {
    const cfg = byRole.get(g.roleId);
    const guild = cfg ? await getGuild(client, cfg.channelId) : client.guilds.cache.get(g.guildId);
    if (!guild) continue;
    if (await removeGrant(guild, g, 'Role sự kiện đã hết hạn (hết Chủ nhật)')) {
      console.log(`[EventRole] ⌛ Đã gỡ role hết hạn ${g.roleId} của ${g.userId}`);
    }
  }
}

let running = false;
async function syncEventRoles(client) {
  if (running) return;
  running = true;
  try {
    await expireGrants(client);
    for (const cfg of EVENT_ROLES) {
      await reconcileKind(client, cfg).catch((e) => console.error(`[EventRole] Lỗi đối soát ${cfg.label}:`, e));
    }
  } catch (e) {
    console.error('[EventRole] Lỗi đồng bộ role sự kiện:', e);
  } finally {
    running = false;
  }
}

let timer = null;
function startEventRoleSync(client, intervalMs = 60000) {
  if (timer) clearInterval(timer);
  console.log('🎖️ Khởi động đồng bộ role sự kiện (Bang Chiến / Scrim)...');
  setTimeout(() => syncEventRoles(client), 8000);
  timer = setInterval(() => syncEventRoles(client), intervalMs);
}

module.exports = { EVENT_ROLES, VOTED_STATUSES, getWeekEndExpiry, syncEventRoles, startEventRoleSync };
