const User = require('../models/User');

const ROLE_DUONG_GIA = '1438965974345842768';
const ROLE_DUONG_CHU = '1438966724082012290';
const ROLE_BANG_CHUNG = '1438967271149146302';

const CLASS_ROLE_MAP = {
  '1479112953813795038': 'Long Ngâm',
  '1439916836895588493': 'Toái Mộng',
  '1439916573031796767': 'Thần Tương',
  '1439916668963782696': 'Huyết Hà',
  '1439916770528854046': 'Tố Vấn',
  '1439916801550061661': 'Thiết Y',
  '1439916837277008005': 'Cửu Linh'
};

const CLASS_KEYWORDS = [
  { name: 'Tố Vấn', keys: ['tố vấn', 'to van', 'tovan', '[tv]', 'tv_'] },
  { name: 'Huyết Hà', keys: ['huyết hà', 'huyet ha', 'huyetha', '[hh]', 'hh_'] },
  { name: 'Thần Tương', keys: ['thần ', 'than tuong', 'thantuong', '[tt]', 'tt_'] },
  { name: 'Toái Mộng', keys: ['toái mộng', 'toai mong', 'toaimong', '[tm]', 'tm_'] },
  { name: 'Thiết Y', keys: ['thiết y', 'thiet y', 'thiety', '[ty]', 'ty_'] },
  { name: 'Long Ngâm', keys: ['long ngâm', 'long ngam', 'longngam', '[ln]', 'ln_'] },
  { name: 'Cửu Linh', keys: ['cửu linh', 'cuu linh', 'cuulinh', '[cl]', 'cl_'] }
];

function detectClass(roleIds, nickname) {
  for (const rId of roleIds || []) {
    if (CLASS_ROLE_MAP[rId]) {
      return CLASS_ROLE_MAP[rId];
    }
  }
  if (!nickname) return 'Chưa rõ';
  const lower = nickname.toLowerCase();
  for (const item of CLASS_KEYWORDS) {
    if (item.keys.some((k) => lower.includes(k))) {
      return item.name;
    }
  }
  return 'Chưa rõ';
}

/**
 * Xử lý thông tin Member thành đối tượng User DB
 */
function formatMemberData(member) {
  const nick = member.nickname || member.user.globalName || member.user.username;
  const roleIds = Array.from(member.roles.cache.keys());
  const roleNames = [];

  let canEdit = false;
  if (roleIds.includes(ROLE_DUONG_GIA)) {
    roleNames.push('Đương Gia');
    canEdit = true;
  }
  if (roleIds.includes(ROLE_DUONG_CHU)) {
    roleNames.push('Đường Chủ');
    canEdit = true;
  }
  if (roleIds.includes(ROLE_BANG_CHUNG)) {
    roleNames.push('Bang Chúng');
  }

  const primaryRole = roleNames[0] || 'Bang Chúng';
  const detectedClass = detectClass(roleIds, nick);

  return {
    discordId: member.user.id,
    username: member.user.username,
    globalName: member.user.globalName || member.user.username,
    nickname: member.nickname || '',
    displayName: nick,
    avatar: member.user.displayAvatarURL({ extension: 'png', size: 128 }),
    className: detectedClass,
    primaryRole: primaryRole,
    roles: roleIds,
    roleNames: roleNames,
    roleName: roleNames.join(', ') || 'Bang Chúng',
    canEdit: canEdit,
    inGuild: true,
    lastSyncedAt: new Date()
  };
}

/**
 * Đồng bộ toàn bộ thành viên của Guild vào MongoDB Atlas
 */
async function syncAllGuildMembers(client) {
  const allowedGuildId = process.env.ALLOWED_GUILD_ID;
  const guilds = allowedGuildId
    ? [client.guilds.cache.get(allowedGuildId)].filter(Boolean)
    : Array.from(client.guilds.cache.values());

  if (guilds.length === 0) {
    console.warn('[MemberSync] Không tìm thấy Guild để đồng bộ thành viên.');
    return;
  }

  for (const guild of guilds) {
    try {
      console.log(`[MemberSync] Đang fetch danh sách thành viên Guild ${guild.name} (${guild.id})...`);
      const members = await guild.members.fetch();
      console.log(`[MemberSync] Đã fetch ${members.size} thành viên từ Discord Gateway.`);

      const operations = [];
      members.forEach((member) => {
        if (member.user.bot) return; // Bỏ qua bot
        const userData = formatMemberData(member);

        operations.push({
          updateOne: {
            filter: { discordId: userData.discordId },
            update: { $set: userData },
            upsert: true
          }
        });
      });

      if (operations.length > 0) {
        const result = await User.bulkWrite(operations);
        console.log(
          `[MemberSync] ✅ Đồng bộ MongoDB thành công cho Guild ${guild.name}: ` +
          `${result.upsertedCount} thêm mới, ${result.modifiedCount} cập nhật (Tổng: ${operations.length} thành viên).`
        );
      }
    } catch (err) {
      console.error(`[MemberSync] ❌ Lỗi khi đồng bộ thành viên Guild ${guild.id}:`, err);
    }
  }
}

/**
 * Lắng nghe các sự kiện cập nhật thành viên theo thời gian thực
 */
function registerMemberSyncEvents(client) {
  // Khi có thành viên mới vào server
  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try {
      const userData = formatMemberData(member);
      await User.findOneAndUpdate(
        { discordId: userData.discordId },
        { $set: userData },
        { upsert: true }
      );
      console.log(`[MemberSync] ➕ Thành viên mới tham gia: ${userData.displayName} (${userData.discordId})`);
    } catch (err) {
      console.error('[MemberSync] Lỗi cập nhật guildMemberAdd:', err.message);
    }
  });

  // Khi thành viên cập nhật role hoặc đổi nickname
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.user.bot) return;
    try {
      const userData = formatMemberData(newMember);
      await User.findOneAndUpdate(
        { discordId: userData.discordId },
        { $set: userData },
        { upsert: true }
      );
    } catch (err) {
      console.error('[MemberSync] Lỗi cập nhật guildMemberUpdate:', err.message);
    }
  });

  // Khi thành viên rời khỏi server
  client.on('guildMemberRemove', async (member) => {
    try {
      await User.findOneAndUpdate(
        { discordId: member.id },
        { $set: { inGuild: false, lastSyncedAt: new Date() } }
      );
      console.log(`[MemberSync] ➖ Thành viên rời server: ${member.user.username} (${member.id})`);
    } catch (err) {
      console.error('[MemberSync] Lỗi cập nhật guildMemberRemove:', err.message);
    }
  });
}

/**
 * Khởi chạy service đồng bộ thành viên
 */
function startMemberSync(client) {
  // 1. Đồng bộ ngay khi khởi động
  syncAllGuildMembers(client);

  // 2. Lắng nghe sự kiện Gateway theo thời gian thực
  registerMemberSyncEvents(client);

  // 3. Định kỳ đồng bộ lại mỗi 15 phút để đảm bảo toàn vẹn dữ liệu
  setInterval(() => {
    syncAllGuildMembers(client);
  }, 15 * 60 * 1000);
}

module.exports = {
  startMemberSync,
  syncAllGuildMembers,
  formatMemberData
};
