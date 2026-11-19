/**
 * Nạp kiến thức game vào kho của Hiền giả.
 *
 *   pnpm run kb:ingest                 # nạp các bài chưa nạp (chạy lại được, tự nối tiếp)
 *   pnpm run kb:ingest -- --refresh    # quét lại toàn bộ, chỉ nạp bài đổi nội dung, xóa bài đã mất
 *   pnpm run kb:ingest -- --limit 50   # nạp thử 50 bài
 *   pnpm run kb:ingest -- --reset      # xóa sạch kho rồi nạp lại từ đầu (khi đổi model embedding)
 */
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { connectDB } = require('../src/core/database');
const { ingestSource } = require('../src/services/knowledge/ingest');
const vnWiki = require('../src/services/knowledge/sources/vnWiki');
const { dropCollection } = require('../src/services/knowledge/knowledgeStore');
const KnowledgeDoc = require('../src/shared/models/KnowledgeDoc');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};

(async () => {
    let code = 0;
    try {
        await connectDB();
        if (flag('reset')) {
            await dropCollection();
            const { deletedCount } = await KnowledgeDoc.deleteMany({ source: vnWiki.SOURCE });
            console.log(`🧹 Đã xóa kho kiến thức và ${deletedCount} bản ghi bài đã nạp.`);
        }
        await ingestSource(vnWiki, {
            mode: flag('refresh') ? 'refresh' : 'new',
            limit: opt('limit') ? Number(opt('limit')) : Infinity,
        });
    } catch (e) {
        console.error('❌ Dừng nạp:', e.message);
        console.error('   Chạy lại cùng lệnh để nạp tiếp từ chỗ dừng.');
        code = 1;
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(code);
})();
