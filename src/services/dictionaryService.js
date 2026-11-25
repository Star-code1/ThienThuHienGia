/**
 * Tra từ điển trực tuyến cho các game chữ — gọi SONG SONG nhiều nguồn, nguồn nào xác nhận trước thì dùng ngay.
 *
 *  Tiếng Việt: dict.minhqnd.com  +  vi.wiktionary.org (MediaWiki API, có phần "Tiếng Việt")
 *  Tiếng Anh : api.dictionaryapi.dev  +  dict.minhqnd.com (kèm nghĩa tiếng Việt)  +  api.datamuse.com (từ vựng, có tần suất)
 *
 * Mỗi hàm trả về { status, meaning?, definition? }:
 *   'found'   — có nguồn xác nhận
 *   'missing' — mọi nguồn đều trả "không có" (chưa chắc là từ sai: thuật ngữ game, tên riêng... → game nhờ AI xét tiếp)
 *   'error'   — chưa kết luận được (có nguồn lỗi/timeout mà chưa nguồn nào xác nhận)
 * Chỉ gửi DUY NHẤT chuỗi từ cần tra ra ngoài, không kèm thông tin người chơi.
 */
const { toKey } = require('../shared/utils/wordGame');

const TIMEOUT_MS = 4000;
const CACHE_MAX = 4000;
const ERROR_COOLDOWN_MS = 30_000;
const DATAMUSE_MIN_FREQ = 0.5; // lượt/triệu từ — lọc từ quá hiếm/lạ của Datamuse

const URLS = {
    minh: 'https://dict.minhqnd.com/api/v1/lookup',
    dictapi: 'https://api.dictionaryapi.dev/api/v2/entries/en/',
    muse: 'https://api.datamuse.com/words',
    viwik: 'https://vi.wiktionary.org/w/api.php',
};

const cache = new Map(); // `${lang}:${key}` -> kết quả found/missing
let fetchImpl = (...args) => fetch(...args);
const cooldownUntil = {};

/** Cho test thay thế fetch. */
function _setFetch(fn) {
    fetchImpl = fn;
    for (const k of Object.keys(cooldownUntil)) delete cooldownUntil[k];
    cache.clear();
}

function remember(key, value) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, value);
}

async function getJson(url, source) {
    if (Date.now() < (cooldownUntil[source] || 0)) return { error: true };
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

/** Chạy các nguồn song song; trả ngay khi có nguồn 'found', nếu không thì tổng hợp missing/error. */
function resolveSources(sources) {
    return new Promise((resolve) => {
        let pending = sources.length;
        let anyError = false;
        const finish = (r) => {
            if (r.status === 'error') anyError = true;
            if (r.status === 'found') return resolve(r);
            if (--pending === 0) resolve({ status: anyError ? 'error' : 'missing' });
        };
        for (const run of sources) {
            run().then(finish, () => finish({ status: 'error' }));
        }
    });
}

// ───────────────────────── Nguồn: dict.minhqnd.com ─────────────────────────

function minhMeaning(data, langCode) {
    const result = (data?.results || []).find((r) => !langCode || r.lang_code === langCode) || data?.results?.[0];
    return shorten(result?.meanings?.[0]?.definition);
}

async function minhSource(key, langCode) {
    const r = await getJson(`${URLS.minh}?word=${encodeURIComponent(key)}`, 'minh');
    if (r.error) return { status: 'error' };
    const has = !r.notFound && r.data?.exists && (r.data.results || []).some((x) => x.lang_code === langCode);
    return has ? { status: 'found', meaning: minhMeaning(r.data, langCode) } : { status: 'missing' };
}

// ───────────────────────── Nguồn: vi.wiktionary.org ─────────────────────────

/** Lấy dòng nghĩa đầu tiên ("# ...") từ wikitext và bỏ ký hiệu liên kết. */
function wikiFirstDefinition(wikitext) {
    const line = String(wikitext || '').split('\n').find((l) => /^#(?![:*#])/.test(l));
    if (!line) return '';
    return shorten(
        line.replace(/^#\s*/, '')
            .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
            .replace(/\{\{[^}]*\}\}/g, '')
            .replace(/'{2,}/g, '')
            .replace(/<[^>]+>/g, '')
    );
}

async function viWiktionarySource(key) {
    const url = `${URLS.viwik}?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(key)}`;
    const r = await getJson(url, 'viwik');
    if (r.error) return { status: 'error' };
    const page = r.data?.query?.pages?.[0];
    const content = page?.revisions?.[0]?.slots?.main?.content || '';
    // Trang phải có mục tiếng Việt (nhiều từ nước ngoài cũng có trang trên vi.wiktionary)
    const isVietnamese = !page?.missing && /\{\{-vie-\}\}|==\s*Tiếng Việt\s*==/i.test(content);
    return isVietnamese ? { status: 'found', meaning: wikiFirstDefinition(content) } : { status: 'missing' };
}

// ───────────────────────── Nguồn tiếng Anh ─────────────────────────

async function dictApiSource(key) {
    const r = await getJson(`${URLS.dictapi}${encodeURIComponent(key)}`, 'dictapi');
    if (r.error) return { status: 'error' };
    if (!Array.isArray(r.data) || !r.data.length) return { status: 'missing' };
    return { status: 'found', definition: shorten(r.data[0]?.meanings?.[0]?.definitions?.[0]?.definition) };
}

async function datamuseSource(key) {
    const r = await getJson(`${URLS.muse}?sp=${encodeURIComponent(key)}&max=1&md=f`, 'muse');
    if (r.error) return { status: 'error' };
    const hit = Array.isArray(r.data) ? r.data[0] : null;
    if (!hit || hit.word?.toLowerCase() !== key) return { status: 'missing' };
    const freq = parseFloat((hit.tags || []).find((t) => t.startsWith('f:'))?.slice(2) ?? '0');
    return freq >= DATAMUSE_MIN_FREQ ? { status: 'found' } : { status: 'missing' };
}

// ───────────────────────── API công khai ─────────────────────────

/** Tra từ/cụm từ tiếng Việt (có dấu). */
async function lookupVietnamese(word) {
    const key = toKey(word);
    const hit = cache.get(`vi:${key}`);
    if (hit) return hit;

    const out = await resolveSources([
        () => minhSource(key, 'vi'),
        () => viWiktionarySource(key),
    ]);
    if (out.status !== 'error') remember(`vi:${key}`, out);
    return out;
}

/** Tra từ tiếng Anh; kèm nghĩa tiếng Việt nếu có. */
async function lookupEnglish(word) {
    const key = String(word || '').trim().toLowerCase();
    const hit = cache.get(`en:${key}`);
    if (hit) return hit;

    // Nghĩa tiếng Việt lấy riêng (không chặn kết quả): chỉ khi tìm được từ
    const viMeaning = minhSource(key, 'en').catch(() => ({ status: 'error' }));
    const out = await resolveSources([
        () => dictApiSource(key),
        () => viMeaning,
        () => datamuseSource(key),
    ]);
    if (out.status === 'found') {
        const vm = await Promise.race([viMeaning, new Promise((r) => setTimeout(() => r(null), 600))]);
        out.meaning = out.meaning || (vm?.status === 'found' ? vm.meaning : '');
        out.definition = out.definition || '';
    }
    if (out.status !== 'error') remember(`en:${key}`, out);
    return out;
}

module.exports = { lookupVietnamese, lookupEnglish, _setFetch };
