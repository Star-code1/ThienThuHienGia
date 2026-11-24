// Kiểm tra cộng/trừ Linh Thạch nguyên tử trên MongoDB thật (chạy trong bộ nhớ).
// Cần gói `mongodb-memory-server` (không nằm trong dependencies để không làm nặng bản deploy);
// nếu không có, test sẽ được bỏ qua. Chạy: NODE_PATH=<thư mục chứa gói> node --test test/
const test = require('node:test');
const assert = require('node:assert');

let MongoMemoryServer;
try {
    ({ MongoMemoryServer } = require('mongodb-memory-server'));
} catch {
    MongoMemoryServer = null;
}

const skip = MongoMemoryServer ? false : 'chưa cài mongodb-memory-server';

test('Linh Thạch nguyên tử', { skip }, async (t) => {
    const mongoose = require('mongoose');
    const server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
    const UserProfile = require('../src/shared/models/UserProfile');

    t.after(async () => {
        await mongoose.disconnect();
        await server.stop();
    });

    await t.test('50 lần cộng song song không mất lần nào', async () => {
        await UserProfile.getOrCreate('a', 'A');
        await Promise.all(Array.from({ length: 50 }, () => UserProfile.incLinhThachById('a', 10)));
        assert.strictEqual((await UserProfile.findOne({ userId: 'a' })).linhThach, 1500);
    });

    await t.test('requireFunds: không đủ tiền thì không trừ', async () => {
        const p = await UserProfile.findOne({ userId: 'a' });
        assert.strictEqual(await p.incLinhThach(-99999, { requireFunds: true }), null);
        assert.strictEqual((await UserProfile.findOne({ userId: 'a' })).linhThach, 1500);
    });

    await t.test('trừ song song: chỉ những lần đủ tiền mới thành công', async () => {
        await UserProfile.getOrCreate('poor', 'P'); // 1000
        const results = await Promise.all(Array.from({ length: 5 }, () =>
            UserProfile.incLinhThachById('poor', -300, { requireFunds: true })));
        assert.strictEqual(results.filter(Boolean).length, 3);
        assert.strictEqual((await UserProfile.findOne({ userId: 'poor' })).linhThach, 100);
    });

    await t.test('clampZero: thua tối đa tới 0 và trả về số thực trừ', async () => {
        const p = await UserProfile.getOrCreate('c', 'C'); // 1000
        assert.strictEqual(await p.incLinhThach(-5000, { clampZero: true }), -1000);
        assert.strictEqual(p.linhThach, 0);
    });

    await t.test('cộng kèm thống kê, save() sau đó không ghi đè số dư', async () => {
        const p = await UserProfile.getOrCreate('d', 'D'); // 1000
        await p.incLinhThach(200, { inc: { 'stats.baucuaGames': 1, 'stats.baucuaWinLinhThach': 200 } });
        assert.strictEqual(p.stats.baucuaGames, 1);
        assert.strictEqual(p.isModified('linhThach'), false);

        await UserProfile.incLinhThachById('d', 1000); // nơi khác cộng tiền
        p.username = 'D2';
        await p.save(); // document cũ, không được ghi đè 2200
        assert.strictEqual((await UserProfile.findOne({ userId: 'd' })).linhThach, 2200);
    });

    await t.test('chuyển Linh Thạch', async () => {
        const from = await UserProfile.getOrCreate('f', 'F'); // 1000
        const to = await UserProfile.getOrCreate('g', 'G');   // 1000
        assert.strictEqual(await UserProfile.transferLinhThach(from, to, 300), true);
        assert.strictEqual(await UserProfile.transferLinhThach(from, to, 5000), false);
        assert.strictEqual((await UserProfile.findOne({ userId: 'f' })).linhThach, 700);
        assert.strictEqual((await UserProfile.findOne({ userId: 'g' })).linhThach, 1300);
    });
});
