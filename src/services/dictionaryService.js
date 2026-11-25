/**
 * Tra từ điển trực tuyến cho các game chữ.
 *  - Tiếng Việt: https://dict.minhqnd.com/api/v1/lookup?word=...
 *  - Tiếng Anh : https://api.dictionaryapi.dev/api/v2/entries/en/<word>  (+ dict.minhqnd.com để lấy nghĩa tiếng Việt)
 *
 * Mỗi hàm trả về { status, meaning? }:
 *   'found'   — từ điển xác nhận có từ
 *   'missing' — từ điển trả 404 (chưa chắc là từ sai: thiếu biến thể, thuật ngữ game, danh từ riêng...)
 *   'error'   — lỗi mạng/timeout/giới hạn tần suất: không kết luận được
 * Chỉ gửi DUY NHẤT chuỗi từ cần tra ra ngoài, không kèm thông tin người chơi.
 */
const { toKey } = require('../shared/utils/wordGame');

const TIMEOUT_MS = 4000;
const CACHE_MAX = 4000;
const ERROR_COOLDOWN_MS = 30_000;

const MINH_URL = 'https://dict.minhqnd.com/api/v1/lookup';
const EN_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

const cache = new Map(); // `${lang}:${key}` -> { status, meaning }  (chỉ lưu found/missing)
let fetchImpl = (...args) => fetch(...args);
let cooldownUntil = { minh: 0, en: 0 };

/** Cho test thay thế fetch. */
function _setFetch(fn) { fetchImpl = fn; cooldownUntil = { minh: 0, en: 0 }; cache.clear(); }

function remember(key, value) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, value);
}

async function getJson(url, source) {
    if (Date.now() < cooldownUntil[source]) return { error: true };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        if (res.status === 404) return { notFound: true };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return { data: await res.json() };
    } catch (err) {
        cooldownUntil[source] = Date.now() + ERROR_COOLDOWN_MS; // nghỉ một lúc, đỡ dội API đang lỗi
        return { error: true };
    } finally {
        clearTimeout(timer);
    }
}

const shorten = (text, max = 90) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** Lấy nghĩa đầu tiên từ phản hồi của dict.minhqnd.com */
function minhMeaning(data, langCode) {
    const result = (data?.results || []).find((r) => !langCode || r.lang_code === langCode) || data?.results?.[0];
    return shorten(result?.meanings?.[0]?.definition);
}

/** Tra từ/cụm từ tiếng Việt (có dấu). */
async function lookupVietnamese(word) {
    const key = toKey(word);
    const hit = cache.get(`vi:${key}`);
    if (hit) return hit;

    const r = await getJson(`${MINH_URL}?word=${encodeURIComponent(key)}`, 'minh');
    if (r.error) return { status: 'error' };
    if (r.notFound || r.data?.exists === false) {
        const out = { status: 'missing' };
        remember(`vi:${key}`, out);
        return out;
    }
    const hasVi = (r.data?.results || []).some((x) => x.lang_code === 'vi');
    if (!r.data?.exists || !hasVi) {
        const out = { status: 'missing' };
        remember(`vi:${key}`, out);
        return out;
    }
    const out = { status: 'found', meaning: minhMeaning(r.data, 'vi') };
    remember(`vi:${key}`, out);
    return out;
}

/** Tra từ tiếng Anh; kèm nghĩa tiếng Việt nếu có. */
async function lookupEnglish(word) {
    const key = String(word || '').trim().toLowerCase();
    const hit = cache.get(`en:${key}`);
    if (hit) return hit;

    const [en, vi] = await Promise.all([
        getJson(`${EN_URL}${encodeURIComponent(key)}`, 'en'),
        getJson(`${MINH_URL}?word=${encodeURIComponent(key)}`, 'minh'),
    ]);

    const enFound = Array.isArray(en.data) && en.data.length > 0;
    const viEntry = vi.data?.exists ? (vi.data.results || []).find((x) => x.lang_code === 'en') : null;

    if (enFound || viEntry) {
        const out = {
            status: 'found',
            meaning: viEntry ? minhMeaning(vi.data, 'en') : '',
            definition: enFound ? shorten(en.data[0]?.meanings?.[0]?.definitions?.[0]?.definition) : '',
        };
        remember(`en:${key}`, out);
        return out;
    }
    if (en.error && vi.error) return { status: 'error' };
    if (en.error || vi.error) return { status: 'error' }; // một nguồn lỗi: chưa dám kết luận "không có"
    const out = { status: 'missing' };
    remember(`en:${key}`, out);
    return out;
}

module.exports = { lookupVietnamese, lookupEnglish, _setFetch };
