const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const mock = (rel, exports) => {
    const p = path.join(__dirname, rel);
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports };
};

const people = [
    { userId: 'a', username: 'Alpha', stats: { vuatiengvietWins: 40, vuatiengvietBestStreak: 7, noituWins: 5, noituBestStreak: 2 } },
    { userId: 'b', username: 'Beta', stats: { vuatiengvietWins: 25, vuatiengvietBestStreak: 9 } },
    { userId: 'c', username: 'Gamma', stats: { vuatiengvietWins: 3, vuatiengvietBestStreak: 1 } },
];
let lastQuery = null;
const UserProfile = {
    find(filter) {
        return {
            sort(sort) {
                lastQuery = { filter, sort };
                const key = Object.keys(sort)[0];
                const get = (p) => key.split('.').reduce((o, k) => o?.[k], p) || 0;
                const rows = people.filter((p) => get(p) > 0).sort((x, y) => get(y) - get(x));
                return { limit: (n) => ({ lean: async () => rows.slice(0, n) }) };
            },
        };
    },
    findOne: ({ userId }) => ({ lean: async () => people.find((p) => p.userId === userId) }),
    countDocuments: async (q) => {
        const [field, cond] = Object.entries(q)[0];
        const k = field.split('.')[1];
        return people.filter((p) => (p.stats[k] || 0) > cond.$gt).length;
    },
};
mock('../src/shared/models/UserProfile.js', UserProfile);

const tuvi = require('../src/features/tu-vi');
const top = tuvi.commands.find((c) => c.data.name === 'top-linhthach');

const run = async (bang, userId = 'x') => {
    let reply;
    await top.execute({
        options: { getString: () => bang },
        user: { id: userId },
        reply: async (p) => { reply = p; },
    });
    return reply.embeds[0].data;
};

test('/top-linhthach có đủ bảng Nối Từ & Vua Tiếng Việt (số lượng + chuỗi)', () => {
    const values = top.data.options[0].choices.map((c) => c.value);
    for (const v of ['noitu', 'noitu_chuoi', 'vua', 'vua_chuoi']) assert.ok(values.includes(v), v);
});

test('bảng Vua Tiếng Việt: xếp theo số câu đúng, hiện kỷ lục chuỗi', async () => {
    const e = await run('vua');
    assert.match(e.title, /VUA TIẾNG VIỆT/);
    assert.ok(e.description.indexOf('Alpha') < e.description.indexOf('Beta'));
    assert.match(e.description, /kỷ lục chuỗi 7/);
});

test('bảng chuỗi: xếp theo chuỗi dài nhất, người ngoài top thấy hạng thật của mình', async () => {
    const e = await run('vua_chuoi');
    assert.ok(e.description.indexOf('Beta') < e.description.indexOf('Alpha')); // chuỗi 9 > 7
    assert.deepEqual(lastQuery.sort, { 'stats.vuatiengvietBestStreak': -1, 'stats.vuatiengvietWins': -1 });
});

test('hạng của người gọi lệnh khi không nằm trong top', async () => {
    people.push(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ userId: 'z' + i, username: 'Z' + i, stats: { vuatiengvietWins: 100 + i } })));
    const e = await run('vua', 'c');
    assert.match(e.description, /👤 \*\*Đạo hữu:\*\* `#13`/); // 12 người cao hơn Gamma (3 câu)
});
