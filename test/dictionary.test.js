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

test('tiếng Việt: có trong từ điển → found (kèm nghĩa), 404 → missing, cache giữ kết quả', async () => {
    dict._setFetch(route([
        ['word=giang%20h%E1%BB%93', () => json(200, { exists: true, word: 'giang hồ', results: [{ lang_code: 'vi', meanings: [{ definition: 'sông và hồ' }] }] })],
        ['word=linh%20th%E1%BA%A1ch', () => json(404, { exists: false })],
    ]));
    calls.length = 0;
    const found = await dict.lookupVietnamese('Giang Hồ');
    assert.equal(found.status, 'found');
    assert.equal(found.meaning, 'sông và hồ');
    assert.equal((await dict.lookupVietnamese('linh thạch')).status, 'missing');
    await dict.lookupVietnamese('giang hồ');
    assert.equal(calls.length, 2, 'lần tra lặp lại phải dùng cache');
});

test('tiếng Việt: lỗi mạng/HTTP 500 → error (không coi là từ sai) và tạm nghỉ để không dội API', async () => {
    let n = 0;
    dict._setFetch(async () => { n++; return json(500, {}); });
    assert.equal((await dict.lookupVietnamese('tiên giới')).status, 'error');
    assert.equal((await dict.lookupVietnamese('giới hạn')).status, 'error');
    assert.equal(n, 1, 'đang nghỉ nên không gọi lại');
});

test('tiếng Anh: dictionaryapi.dev hoặc dict.minhqnd.com có từ là found', async () => {
    dict._setFetch(route([
        ['dictionaryapi.dev', () => json(200, [{ word: 'beautiful', meanings: [{ definitions: [{ definition: 'Attractive.' }] }] }])],
        ['minhqnd', () => json(200, { exists: true, results: [{ lang_code: 'en', meanings: [{ definition: 'Đẹp; hay.' }] }] })],
    ]));
    const r = await dict.lookupEnglish('Beautiful');
    assert.equal(r.status, 'found');
    assert.equal(r.meaning, 'Đẹp; hay.');
    assert.equal(r.definition, 'Attractive.');

    dict._setFetch(route([
        ['dictionaryapi.dev', () => json(404, {})],
        ['minhqnd', () => json(200, { exists: true, results: [{ lang_code: 'en', meanings: [{ definition: 'Chó' }] }] })],
    ]));
    assert.equal((await dict.lookupEnglish('dogs')).status, 'found');
});

test('tiếng Anh: cả hai 404 → missing; một nguồn lỗi → error (chưa kết luận)', async () => {
    dict._setFetch(route([
        ['dictionaryapi.dev', () => json(404, {})],
        ['minhqnd', () => json(404, { exists: false })],
    ]));
    assert.equal((await dict.lookupEnglish('asdfjkl')).status, 'missing');

    dict._setFetch(route([
        ['dictionaryapi.dev', () => json(404, {})],
        ['minhqnd', () => { throw new Error('timeout'); }],
    ]));
    assert.equal((await dict.lookupEnglish('qwerty')).status, 'error');
});

test('validateWordVI/EN: từ điển xác nhận → hợp lệ ngay, không cần AI', async () => {
    const { validateWordVI, validateWordEN } = require('../src/services/aiService');
    dict._setFetch(route([
        ['minhqnd', (url) => String(url).includes('word=ti%C3%AAn%20gi%E1%BB%9Bi')
            ? json(200, { exists: true, results: [{ lang_code: 'vi', meanings: [{ definition: 'nơi tiên ở' }] }] })
            : json(200, { exists: true, results: [{ lang_code: 'en', meanings: [{ definition: 'Rồng' }] }] })],
        ['dictionaryapi.dev', () => json(200, [{ word: 'nirvana', meanings: [{ definitions: [{ definition: 'Bliss.' }] }] }])],
    ]));
    const vi = await validateWordVI('Tu Tiên', 'Tiên Giới');
    assert.equal(vi.valid, true);
    assert.match(vi.reason, /nơi tiên ở/);
    const en = await validateWordEN('Dragon', 'Nirvana');
    assert.equal(en.valid, true);
});
