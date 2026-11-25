const test = require('node:test');
const assert = require('node:assert/strict');
const dict = require('../src/services/dictionaryService');

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const calls = [];
const route = (handlers) => async (url) => {
    calls.push(String(url));
    for (const [match, fn] of handlers) if (String(url).includes(match)) return fn(url);
    throw new Error('unexpected url ' + url);
};

const wiki = (title, content) => json(200, { query: { pages: [content === null ? { title, missing: true } : { title, revisions: [{ slots: { main: { content } } }] }] } });
const viMinh = (def) => json(200, { exists: true, results: [{ lang_code: 'vi', meanings: [{ definition: def }] }] });
const noMinh = () => json(404, { exists: false });

test('tiếng Việt: dict.minhqnd.com có từ → found (kèm nghĩa), cache giữ kết quả', async () => {
    dict._setFetch(route([
        ['minhqnd', () => viMinh('sông và hồ')],
        ['vi.wiktionary', () => wiki('giang hồ', null)],
    ]));
    calls.length = 0;
    const found = await dict.lookupVietnamese('Giang Hồ');
    assert.equal(found.status, 'found');
    assert.equal(found.meaning, 'sông và hồ');
    const before = calls.length;
    await dict.lookupVietnamese('giang hồ');
    assert.equal(calls.length, before, 'lần tra lặp lại phải dùng cache');
});

test('tiếng Việt: dict.minhqnd.com không có nhưng vi.wiktionary có mục Tiếng Việt → found; trang tiếng nước ngoài không tính', async () => {
    dict._setFetch(route([
        ['minhqnd', noMinh],
        ['vi.wiktionary', () => wiki('hoàng hôn', "{{-vie-}}\n\n{{-noun-}}\n# [[lúc|Lúc]] [[mặt trời]] '''lặn'''.\n")],
    ]));
    const r = await dict.lookupVietnamese('hoàng hôn');
    assert.equal(r.status, 'found');
    assert.equal(r.meaning, 'Lúc mặt trời lặn.');

    dict._setFetch(route([
        ['minhqnd', noMinh],
        ['vi.wiktionary', () => wiki('hello', '==Tiếng Anh==\n# xin chào\n')],
    ]));
    assert.equal((await dict.lookupVietnamese('hello')).status, 'missing');
});

test('tiếng Việt: mọi nguồn 404 → missing; một nguồn lỗi → error; lỗi thì nghỉ, không dội API', async () => {
    dict._setFetch(route([
        ['minhqnd', noMinh],
        ['vi.wiktionary', () => wiki('linh thạch', null)],
    ]));
    assert.equal((await dict.lookupVietnamese('linh thạch')).status, 'missing');

    let n = 0;
    dict._setFetch(async (url) => { n++; return String(url).includes('minhqnd') ? json(500, {}) : wiki('x', null); });
    assert.equal((await dict.lookupVietnamese('tiên giới')).status, 'error');
    const first = n;
    await dict.lookupVietnamese('giới hạn');
    assert.ok(n - first <= 1, 'nguồn đang lỗi phải được nghỉ');
});

test('tiếng Anh: chỉ cần một nguồn xác nhận (dictionaryapi / minhqnd / datamuse)', async () => {
    const dictApi = () => json(200, [{ word: 'beautiful', meanings: [{ definitions: [{ definition: 'Attractive.' }] }] }]);
    const enMinh = () => json(200, { exists: true, results: [{ lang_code: 'en', meanings: [{ definition: 'Đẹp; hay.' }] }] });
    const muse = (word, f) => () => json(200, [{ word, score: 1, tags: [`f:${f}`] }]);

    dict._setFetch(route([['dictionaryapi.dev', dictApi], ['minhqnd', enMinh], ['datamuse', muse('beautiful', 20)]]));
    const r = await dict.lookupEnglish('Beautiful');
    assert.equal(r.status, 'found');

    dict._setFetch(route([['dictionaryapi.dev', () => json(404, {})], ['minhqnd', noMinh], ['datamuse', muse('dragons', 1.4)]]));
    assert.equal((await dict.lookupEnglish('dragons')).status, 'found'); // chỉ Datamuse biết (số nhiều)

    dict._setFetch(route([['dictionaryapi.dev', () => json(404, {})], ['minhqnd', enMinh], ['datamuse', () => json(200, [])]]));
    assert.equal((await dict.lookupEnglish('dogs')).status, 'found');
});

test('tiếng Anh: Datamuse lọc từ quá hiếm / gần giống; tất cả 404 → missing; có nguồn lỗi → error', async () => {
    const none = [['dictionaryapi.dev', () => json(404, {})], ['minhqnd', noMinh]];
    dict._setFetch(route([...none, ['datamuse', () => json(200, [{ word: 'qwxzt', tags: ['f:0.01'] }])]]));
    assert.equal((await dict.lookupEnglish('qwxzt')).status, 'missing');       // quá hiếm
    dict._setFetch(route([...none, ['datamuse', () => json(200, [{ word: 'dragon', tags: ['f:5'] }])]]));
    assert.equal((await dict.lookupEnglish('dragoon')).status, 'missing');     // chỉ gần giống chứ không khớp
    dict._setFetch(route([...none, ['datamuse', () => json(200, [])]]));
    assert.equal((await dict.lookupEnglish('asdfjkl')).status, 'missing');

    dict._setFetch(route([...none, ['datamuse', () => { throw new Error('timeout'); }]]));
    assert.equal((await dict.lookupEnglish('qwerty')).status, 'error');
});

test('validateWordVI/EN: từ điển xác nhận → hợp lệ ngay, không cần AI', async () => {
    const { validateWordVI, validateWordEN } = require('../src/services/aiService');
    dict._setFetch(route([
        ['minhqnd', (url) => String(url).includes('word=ti%C3%AAn%20gi%E1%BB%9Bi')
            ? viMinh('nơi tiên ở')
            : json(200, { exists: true, results: [{ lang_code: 'en', meanings: [{ definition: 'Niết bàn' }] }] })],
        ['dictionaryapi.dev', () => json(200, [{ word: 'nirvana', meanings: [{ definitions: [{ definition: 'Bliss.' }] }] }])],
        ['datamuse', () => json(200, [])],
        ['vi.wiktionary', () => wiki('x', null)],
    ]));
    const vi = await validateWordVI('Tu Tiên', 'Tiên Giới');
    assert.equal(vi.valid, true);
    assert.match(vi.reason, /nơi tiên ở/);
    const en = await validateWordEN('Dragon', 'Nirvana');
    assert.equal(en.valid, true);
});
