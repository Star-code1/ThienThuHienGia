const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeText, toKey, parseVietnameseWord, parseEnglishWord, isVietnameseSyllable,
    hintLeaksAnswer, matchesAnswer, describeStructure,
} = require('../src/shared/utils/wordGame');
const { scrambleVietnameseWord } = require('../src/shared/utils/vietnameseHelper');
const { WORD_BANK } = require('../src/shared/data/vuaWordBank');
const { claimChannel, releaseChannel } = require('../src/shared/channelGames');
const { validateWordVI, validateWordEN } = require('../src/services/aiService');

test('normalizeText: NFC, gộp khoảng trắng, bỏ dấu câu hai đầu', () => {
    const decomposed = 'Tiên'.normalize('NFD'); // "Tiên" dạng tổ hợp
    assert.equal(normalizeText(`  "${decomposed}   Giới!! "`), 'Tiên Giới');
    assert.equal(toKey('TIÊN'), toKey('Tiên'));
});

test('parseVietnameseWord: chỉ nhận từ ghép tiếng Việt 2–4 tiếng', () => {
    assert.equal(parseVietnameseWord('Tiên Giới').ok, true);
    assert.equal(parseVietnameseWord('  linh   thạch ').text, 'linh thạch');
    assert.equal(parseVietnameseWord('Tiên').ok, false);                 // 1 tiếng
    assert.equal(parseVietnameseWord('a b c d e').ok, false);             // quá dài
    assert.equal(parseVietnameseWord('hello world 123').ok, false);       // có số
    assert.equal(parseVietnameseWord('Facebook live').ok, false);         // f, w... không thuộc tiếng Việt
    assert.equal(parseVietnameseWord('tiên @everyone').ok, false);        // không cho lọt mention
    assert.equal(parseVietnameseWord('đạo hữu').ok, true);
    assert.equal(parseVietnameseWord('x'.repeat(41)).ok, false);
});

test('isVietnameseSyllable', () => {
    for (const s of ['nghiêng', 'khuya', 'đ' + 'ược', 'quyền', 'y']) assert.equal(isVietnameseSyllable(s), true, s);
    for (const s of ['zzz', 'bcdfg', 'quéééééééé', '']) assert.equal(isVietnameseSyllable(s), false, s);
});

test('parseEnglishWord: đúng một từ chỉ chữ cái', () => {
    assert.equal(parseEnglishWord('Dragon').ok, true);
    assert.equal(parseEnglishWord('two words').ok, false);
    assert.equal(parseEnglishWord('a').ok, false);
    assert.equal(parseEnglishWord('r2d2').ok, false);
    assert.equal(parseEnglishWord('café').ok, false);
});

test('matchesAnswer: có dấu / không dấu / dấu câu cuối đều đúng, từ khác thì sai', () => {
    assert.equal(matchesAnswer('hoàng hôn', 'HOÀNG HÔN'), true);
    assert.equal(matchesAnswer('hoang hon', 'HOÀNG HÔN'), true);
    assert.equal(matchesAnswer('  Hoàng   Hôn! ', 'HOÀNG HÔN'), true);
    assert.equal(matchesAnswer('hoàng hồn', 'HOÀNG HÔN'), true); // chấp nhận sai dấu thanh (so khớp không dấu)
    assert.equal(matchesAnswer('hoàng hoa', 'HOÀNG HÔN'), false);
    assert.equal(matchesAnswer('hoàng hôn rồi', 'HOÀNG HÔN'), false);
    assert.equal(matchesAnswer('x'.repeat(100), 'HOÀNG HÔN'), false);
    assert.equal(matchesAnswer('đạo hữu', 'ĐẠO HỮU'), true);
    assert.equal(matchesAnswer('dao huu', 'ĐẠO HỮU'), true);
});

test('hintLeaksAnswer phát hiện lộ tiếng của đáp án kể cả khi bỏ dấu', () => {
    assert.equal(hintLeaksAnswer('Mặt trời lên cao hoang vu', 'HOÀNG HÔN'), true);
    assert.equal(hintLeaksAnswer('Khi vầng dương khuất sau chân trời', 'HOÀNG HÔN'), false);
});

test('scramble giữ nguyên đủ chữ cái và không trùng thứ tự gốc', () => {
    for (let i = 0; i < 50; i++) {
        const out = scrambleVietnameseWord('HOÀNG HÔN');
        const letters = out.split(' ').sort().join('');
        assert.equal(letters, Array.from('HOÀNGHÔN').sort().join(''));
        assert.notEqual(out.replace(/ /g, ''), 'HOÀNGHÔN');
    }
    assert.equal(describeStructure('HOÀNG HÔN'), '2 tiếng (5 + 3 chữ cái)');
});

test('ngân hàng từ Vua Tiếng Việt: đủ độ khó, 2 tiếng, không trùng, gợi ý không lộ đáp án', () => {
    const seen = new Set();
    for (const { level, word, hint } of WORD_BANK) {
        assert.ok(['de', 'trung_binh', 'kho'].includes(level), word);
        assert.equal(word, word.normalize('NFC'), `${word} chưa NFC`);
        const p = parseVietnameseWord(word, { minSyllables: 2, maxSyllables: 2 });
        assert.ok(p.ok, `${word} không đạt hình thức`);
        assert.equal(word, word.toUpperCase());
        assert.ok(!hintLeaksAnswer(hint, word), `gợi ý của ${word} lộ đáp án`);
        assert.ok(hint.length >= 8 && hint.length <= 120, word);
        assert.ok(!seen.has(word), `${word} bị trùng`);
        seen.add(word);
    }
    for (const lv of ['de', 'trung_binh', 'kho']) {
        assert.ok(WORD_BANK.filter((e) => e.level === lv).length >= 10, `thiếu từ mức ${lv}`);
    }
});

test('sổ kênh: một kênh chỉ một game chữ', () => {
    assert.equal(claimChannel('c1', 'noitu'), null);
    assert.equal(claimChannel('c1', 'noitu'), null);          // cùng game: ok
    assert.equal(claimChannel('c1', 'vuatiengviet'), 'noitu'); // khác game: bị chặn
    releaseChannel('c1', 'vuatiengviet');                      // sai chủ: không nhả
    assert.equal(claimChannel('c1', 'vuatiengviet'), 'noitu');
    releaseChannel('c1', 'noitu');
    assert.equal(claimChannel('c1', 'vuatiengviet'), null);
    releaseChannel('c1', 'vuatiengviet');
});

test('validateWordVI/EN: từ chối ngay (không gọi AI) khi sai hình thức hoặc sai luật nối', async () => {
    assert.equal((await validateWordVI('Tu Tiên', 'Tiên')).valid, false);            // 1 tiếng
    assert.equal((await validateWordVI('Tu Tiên', 'Giới Hạn')).valid, false);        // sai tiếng nối
    assert.equal((await validateWordVI('Tu Tiên', 'Tien Giới')).valid, false);       // thiếu dấu → khác tiếng
    assert.equal((await validateWordEN('Dragon', 'apple')).valid, false);            // sai chữ nối
    assert.equal((await validateWordEN('Dragon', 'not a word')).valid, false);       // nhiều từ
});
