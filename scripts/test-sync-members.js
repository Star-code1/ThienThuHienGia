require('dotenv').config();
const client = require('../src/core/client');
const { connectDB } = require('../src/core/database');
const { syncAllGuildMembers } = require('../src/services/memberSyncService');
const User = require('../src/models/User');

(async () => {
  try {
    console.log('🔗 Đang kết nối MongoDB...');
    await connectDB();

    console.log('🔐 Đang đăng nhập Discord client...');
    await client.login(process.env.DISCORD_TOKEN);

    console.log('⏳ Đợi client sẵn sàng...');
    await new Promise((resolve) => {
      if (client.isReady()) return resolve();
      client.once('ready', resolve);
    });

    console.log(`🤖 Logged in as: ${client.user.tag}`);
    console.log('🚀 Bắt đầu đồng bộ thành viên vào MongoDB Atlas...');
    await syncAllGuildMembers(client);

    const countBangChung = await User.countDocuments({ roles: '1438967271149146302' });
    const countTotal = await User.countDocuments({});

    console.log(`\n🎉 KẾT QUẢ ĐỒNG BỘ:`);
    console.log(`- Tổng số User trong DB: ${countTotal}`);
    console.log(`- Số thành viên mang Role Bang Chúng (1438967271149146302): ${countBangChung}`);

    const sample = await User.find({ roles: '1438967271149146302' }).limit(3).lean();
    console.log('\n📄 Mẫu 3 thành viên:');
    sample.forEach((u, i) => {
      console.log(`  ${i + 1}. [${u.className}] ${u.displayName} (@${u.username}) - Roles: ${u.roleName}`);
    });

    console.log('\n✅ Đồng bộ thành công hoàn tất!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi chạy test-sync-members:', err);
    process.exit(1);
  }
})();
