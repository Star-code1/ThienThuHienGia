/**
 * Kho kiến thức game trên Qdrant — collection riêng "game_knowledge", tách khỏi lịch sử chat.
 */
const crypto = require('crypto');
const { VECTOR_SIZE, EMBED_MODEL, embedQuery } = require('./embeddings');

const COLLECTION = process.env.KNOWLEDGE_COLLECTION || 'game_knowledge';
const TIMEOUT_MS = 15_000;

const qdrantUrl = () => (process.env.QDRANT_URL || '').replace(/\/$/, '');

async function qdrant(path, { method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
    if (!qdrantUrl()) throw new Error('Thiếu QDRANT_URL');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.QDRANT_API_KEY) headers['api-key'] = process.env.QDRANT_API_KEY;
    const res = await fetch(`${qdrantUrl()}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
        const err = new Error(`Qdrant ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

let ensured = false;
async function ensureCollection() {
    if (ensured) return;
    try {
        const info = await qdrant(`/collections/${COLLECTION}`);
        const size = info.result?.config?.params?.vectors?.size;
        if (size && size !== VECTOR_SIZE) {
            throw new Error(`Collection "${COLLECTION}" đang ${size} chiều, model hiện tại ${VECTOR_SIZE} chiều — chạy "pnpm run kb:ingest -- --reset" để tạo lại kho.`);
        }
    } catch (e) {
        if (e.status !== 404) throw e;
        await qdrant(`/collections/${COLLECTION}`, { method: 'PUT', body: { vectors: { size: VECTOR_SIZE, distance: 'Cosine' } } });
        console.log(`✅ Đã tạo Qdrant collection "${COLLECTION}" (${VECTOR_SIZE} chiều)`);
    }
    for (const field of ['url', 'source']) {
        await qdrant(`/collections/${COLLECTION}/index`, {
            method: 'PUT',
            body: { field_name: field, field_schema: 'keyword' },
        }).catch(() => {}); // đã có index thì bỏ qua
    }
    ensured = true;
}

/** UUID ổn định cho đoạn thứ i của một URL. */
function pointId(url, index) {
    const h = crypto.createHash('sha1').update(`${url}#${index}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function deleteByUrl(url) {
    await ensureCollection();
    await qdrant(`/collections/${COLLECTION}/points/delete?wait=true`, {
        method: 'POST',
        body: { filter: { must: [{ key: 'url', match: { value: url } }] } },
    });
}

/**
 * Ghi các đoạn của nhiều bài. items: [{ doc:{url,title,source}, chunks:[text], vectors:[[...]] }]
 * Xóa đoạn cũ của bài trước khi ghi để không sót đoạn thừa khi bài ngắn lại.
 */
async function upsertDocs(items) {
    await ensureCollection();
    for (const { doc } of items) await deleteByUrl(doc.url);
    const points = items.flatMap(({ doc, chunks, vectors }) => chunks.map((text, i) => ({
        id: pointId(doc.url, i),
        vector: vectors[i],
        payload: {
            url: doc.url,
            title: doc.title,
            source: doc.source,
            chunkIndex: i,
            text,
            embedModel: EMBED_MODEL,
        },
    })));
    for (let i = 0; i < points.length; i += 200) {
        await qdrant(`/collections/${COLLECTION}/points?wait=true`, {
            method: 'PUT',
            body: { points: points.slice(i, i + 200) },
            timeout: 60_000,
        });
    }
    return points.length;
}

// Qdrant/Gemini lỗi -> tạm ngừng tra cứu một lúc, tránh làm chậm mọi câu trả lời
const PAUSE_AFTER_ERROR_MS = 60_000;
let pausedUntil = 0;

/** Tìm các đoạn kiến thức liên quan tới câu hỏi. Lỗi thì trả [] (Hiền giả vẫn trả lời bình thường). */
async function searchKnowledge(query, { topK = 5, minScore = 0.55 } = {}) {
    if (!qdrantUrl() || !query || Date.now() < pausedUntil) return [];
    try {
        await ensureCollection();
        const vector = await embedQuery(query);
        const data = await qdrant(`/collections/${COLLECTION}/points/search`, {
            method: 'POST',
            body: { vector, limit: topK, with_payload: true, score_threshold: minScore },
            timeout: 5000,
        });
        return (data.result || []).map((r) => ({ score: r.score, ...r.payload }));
    } catch (e) {
        pausedUntil = Date.now() + PAUSE_AFTER_ERROR_MS;
        console.warn(`⚠️ Kho kiến thức tạm ngừng ${PAUSE_AFTER_ERROR_MS / 1000}s: ${e.cause?.code || e.message}`);
        return [];
    }
}

/** Xóa toàn bộ kho kiến thức (dùng khi đổi model embedding). */
async function dropCollection() {
    await qdrant(`/collections/${COLLECTION}`, { method: 'DELETE' }).catch((e) => { if (e.status !== 404) throw e; });
    ensured = false;
}

async function countPoints() {
    await ensureCollection();
    const data = await qdrant(`/collections/${COLLECTION}/points/count`, { method: 'POST', body: { exact: true } });
    return data.result?.count || 0;
}

module.exports = { COLLECTION, ensureCollection, dropCollection, upsertDocs, deleteByUrl, searchKnowledge, countPoints, pointId };
