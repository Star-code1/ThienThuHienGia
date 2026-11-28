/**
 * Tiện ích thuần (không phụ thuộc Discord/AI) cho các game chữ: Nối Từ & Vua Tiếng Việt.
 * Tách riêng để kiểm thử được và dùng chung một chuẩn chuẩn hoá chữ.
 */
const { removeAccents } = require('./vietnameseHelper');

const EDGE_PUNCT = /^[\s"'“”‘’.,!?;:…\-–—()[\]{}*_~`]+|[\s"'“”‘’.,!?;:…\-–—()[\]{}*_~`]+$/g;

/** Chuẩn hoá NFC, gộp khoảng trắng, bỏ dấu câu ở hai đầu. */
function normalizeText(str) {
    return String(str ?? '').normalize('NFC').replace(EDGE_PUNCT, '').replace(/\s+/g, ' ').trim();
}

/** Khoá so sánh: chuẩn hoá + chữ thường (GIỮ dấu thanh). */
const toKey = (str) => normalizeText(str).toLowerCase();

/** Khoá so sánh bỏ dấu: dùng để tránh trùng lặp/lộ đáp án. */
const toPlainKey = (str) => removeAccents(normalizeText(str)).toLowerCase();

const splitSyllables = (str) => normalizeText(str).split(' ').filter(Boolean);

/**
 * Một tiếng Việt hợp lệ về hình thức: chỉ chữ cái tiếng Việt, 1–7 chữ, có nguyên âm,
 * không chứa f/j/w/z (không thuộc bảng chữ cái tiếng Việt).
 */
function isVietnameseSyllable(syllable) {
    const plain = removeAccents(syllable).toLowerCase();
    if (!/^[a-z]{1,7}$/.test(plain)) return false;
    if (/[fjwz]/.test(plain)) return false;
    return /[aeiouy]/.test(plain);
}

/**
 * Phân tích một câu nhắn có phải là "lượt nối từ" tiếng Việt hay không.
 * @returns {{ ok: boolean, text?: string, syllables?: string[], reason?: string }}
 */
function parseVietnameseWord(input, { minSyllables = 2, maxSyllables = 4 } = {}) {
    const text = normalizeText(input);
    if (!text || text.length > 40) return { ok: false, reason: 'shape' };
    const syllables = text.split(' ');
    if (syllables.length < minSyllables) return { ok: false, reason: 'too-short' };
    if (syllables.length > maxSyllables) return { ok: false, reason: 'shape' };
    if (!syllables.every(isVietnameseSyllable)) return { ok: false, reason: 'shape' };
    return { ok: true, text, syllables };
}

/** Nối Từ tiếng Việt chỉ nhận từ ghép đúng 2 tiếng. */
const NOITU_VI_SHAPE = Object.freeze({ minSyllables: 2, maxSyllables: 2 });

/** Phân tích một lượt nối từ tiếng Anh: đúng 1 từ, chỉ chữ cái, 2–30 ký tự. */
function parseEnglishWord(input) {
    const text = normalizeText(input);
    if (!/^[A-Za-z]{2,30}$/.test(text)) return { ok: false, reason: 'shape' };
    return { ok: true, text };
}

/** Câu gợi ý có lộ tiếng nào của đáp án không (so không dấu)? */
function hintLeaksAnswer(hint, answer) {
    const hintTokens = new Set(toPlainKey(hint).split(/[^a-z]+/).filter(Boolean));
    return splitSyllables(answer).some((syl) => hintTokens.has(toPlainKey(syl)));
}

/** Số chữ cái mỗi tiếng, ví dụ "HOÀNG HÔN" -> [5, 3] */
const syllableLengths = (word) => splitSyllables(word).map((s) => Array.from(s).length);

/** Chữ ghép kiểu "5 + 3 chữ cái" để gợi cấu trúc đáp án mà không lộ chữ. */
const describeStructure = (word) => {
    const lens = syllableLengths(word);
    return `${lens.length} tiếng (${lens.join(' + ')} chữ cái)`;
};

/** Đáp án của Vua Tiếng Việt có khớp không (chấp nhận có/không dấu, bỏ dấu câu cuối). */
function matchesAnswer(guess, answer) {
    const g = normalizeText(guess);
    if (!g || g.length > 60) return false;
    return toKey(g) === toKey(answer) || toPlainKey(g) === toPlainKey(answer);
}

/** Thưởng thêm theo chuỗi thắng: từ chuỗi thứ 2 trở đi +5 💎 mỗi bậc (không tính bậc đầu), tối đa +30 💎. */
const STREAK_BONUS_STEP = 5;
const STREAK_BONUS_MAX = 30;
const streakBonus = (streak) => Math.min(Math.max(0, streak - 1) * STREAK_BONUS_STEP, STREAK_BONUS_MAX);

module.exports = {
    streakBonus,
    normalizeText,
    toKey,
    toPlainKey,
    splitSyllables,
    isVietnameseSyllable,
    parseVietnameseWord,
    NOITU_VI_SHAPE,
    parseEnglishWord,
    hintLeaksAnswer,
    syllableLengths,
    describeStructure,
    matchesAnswer,
};
