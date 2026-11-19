const { Events } = require('discord.js');

/** Người nhận mặc định cho mọi script test DM */
const DEFAULT_TEST_TARGET = process.env.TEST_DM_TARGET || 'taobao_123456';

/** Đăng nhập và chờ client sẵn sàng (guild cache đã có). */
async function loginAndWait(client) {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.DISCORD_TOKEN);
  await ready;
}

/**
 * Đổi username / tên hiển thị / ID thành User ID.
 * Tìm trong các server bot đang ở; nếu không thấy thì tra bảng User trong DB.
 */
async function resolveTargetUserId(client, target = DEFAULT_TEST_TARGET) {
  const query = String(target).trim().replace(/^@/, '');
  if (/^\d{15,22}$/.test(query)) return query;

  const lower = query.toLowerCase();
  for (const guild of client.guilds.cache.values()) {
    const found = await guild.members.search({ query, limit: 20 }).catch(() => null);
    const member = found?.find((m) =>
      [m.user.username, m.user.globalName, m.displayName].some((n) => n && n.toLowerCase() === lower)
    );
    if (member) return member.id;
  }

  try {
    const User = require('../../src/models/User');
    const doc = await User.findOne({ username: new RegExp(`^${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
    if (doc?.discordId) return doc.discordId;
  } catch (_) { /* DB không sẵn sàng */ }

  throw new Error(`Không tìm thấy người dùng "${query}" trong server nào bot đang ở.`);
}

module.exports = { DEFAULT_TEST_TARGET, loginAndWait, resolveTargetUserId };
