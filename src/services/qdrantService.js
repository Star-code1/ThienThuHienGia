const crypto = require('crypto');

const QDRANT_URL = process.env.QDRANT_URL ? process.env.QDRANT_URL.replace(/\/$/, '') : null;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || null;
const COLLECTION_NAME = 'discord_messages';
const VECTOR_SIZE = 1536; // OpenAI text-embedding-3-small (qua OpenRouter) dimension
const QDRANT_TIMEOUT_MS = 10000;
// Kết nối Qdrant lỗi -> chờ bấy lâu rồi mới thử lại (không khóa vĩnh viễn tới khi restart)
const QDRANT_RETRY_AFTER_MS = 60 * 1000;
// Đồng bộ với TTL của ChatMessage (60 ngày) để ký ức vector không sống lâu hơn tin nhắn gốc
const VECTOR_RETENTION_DAYS = 60;

// Mỗi model embedding là một "không gian vector" riêng: KHÔNG được so sánh vector
// của model này với model khác. Vì vậy mỗi point lưu kèm embedModel và khi search
// chỉ so với các point cùng model.
const EMBED_MODEL_OPENAI = 'openai/text-embedding-3-small';
const EMBED_MODEL_GEMINI = 'gemini-embedding-001@1536';

let isQdrantAvailable = null; // null = chưa kiểm tra
let nextQdrantRetryAt = 0;
let qdrantErrorLogged = false;
let embeddingErrorLogged = false;

function qdrantHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;
    return headers;
}

function qdrantFetch(path, options = {}) {
    return fetch(`${QDRANT_URL}${path}`, {
        ...options,
        headers: qdrantHeaders(),
        signal: AbortSignal.timeout(QDRANT_TIMEOUT_MS)
    });
}

/**
 * Sinh Embedding cho văn bản (Ưu tiên OpenRouter text-embedding-3-small, fallback Gemini).
 * Trả về { vector, model } hoặc null. Vector luôn có đúng VECTOR_SIZE chiều.
 */
async function generateEmbedding(text) {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // 1. OpenRouter Embedding (openai/text-embedding-3-small, 1536 chiều)
    if (openrouterKey) {
        try {
            const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openrouterKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://discordbot.org',
                    'X-Title': 'ThienThuHienGia_DiscordBot'
                },
                body: JSON.stringify({ model: EMBED_MODEL_OPENAI, input: text }),
                signal: AbortSignal.timeout(QDRANT_TIMEOUT_MS)
            });

            if (res.ok) {
                const data = await res.json();
                const embedding = data.data?.[0]?.embedding;
                if (Array.isArray(embedding) && embedding.length === VECTOR_SIZE) {
                    return { vector: embedding, model: EMBED_MODEL_OPENAI };
                }
            }
        } catch (e) {
            // Bỏ qua, thử fallback
        }
    }

    // 2. Gemini gemini-embedding-001 với outputDimensionality = 1536 cho khớp collection
    if (geminiKey) {
        try {
            const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
                body: JSON.stringify({
                    content: { parts: [{ text }] },
                    outputDimensionality: VECTOR_SIZE
                }),
                signal: AbortSignal.timeout(QDRANT_TIMEOUT_MS)
            });

            if (res.ok) {
                const data = await res.json();
                const values = data.embedding?.values;
                if (Array.isArray(values) && values.length === VECTOR_SIZE) {
                    return { vector: values, model: EMBED_MODEL_GEMINI };
                }
            }
        } catch (err) {}
    }

    if (!embeddingErrorLogged) {
        console.warn('⚠️ Cảnh báo: Không thể sinh Vector Embedding. Hệ thống vẫn lưu MongoDB & Summary bình thường!');
        embeddingErrorLogged = true;
    }
    return null;
}

/**
 * Khởi tạo Collection trong Qdrant nếu chưa tồn tại
 */
async function ensureQdrantCollection() {
    try {
        const checkRes = await qdrantFetch(`/collections/${COLLECTION_NAME}`);
        if (checkRes.ok) return true;

        const createRes = await qdrantFetch(`/collections/${COLLECTION_NAME}`, {
            method: 'PUT',
            body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: 'Cosine' } })
        });

        if (createRes.ok) {
            console.log(`✅ Qdrant Collection "${COLLECTION_NAME}" (size: ${VECTOR_SIZE}) đã khởi tạo thành công.`);
            return true;
        }
        console.warn('⚠️ Không thể khởi tạo Qdrant Collection:', (await createRes.text()).slice(0, 300));
    } catch (e) {
        if (!qdrantErrorLogged) {
            console.warn(`⚠️ Không thể kết nối Qdrant Server (${e.cause?.code || e.message}). Sẽ tự thử lại sau ${QDRANT_RETRY_AFTER_MS / 1000}s.`);
            qdrantErrorLogged = true;
        }
    }
    return false;
}

/**
 * Qdrant có sẵn sàng không. Nếu lần trước lỗi thì chỉ thử lại sau QDRANT_RETRY_AFTER_MS,
 * thay vì khóa vĩnh viễn tới khi restart bot.
 */
async function isQdrantReady() {
    if (!QDRANT_URL) return false;
    if (isQdrantAvailable === true) return true;
    if (Date.now() < nextQdrantRetryAt) return false;

    isQdrantAvailable = await ensureQdrantCollection();
    if (isQdrantAvailable) {
        if (qdrantErrorLogged) console.log('✅ Đã kết nối lại Qdrant.');
        qdrantErrorLogged = false;
    } else {
        nextQdrantRetryAt = Date.now() + QDRANT_RETRY_AFTER_MS;
    }
    return isQdrantAvailable;
}

/** Lỗi mạng giữa chừng -> đánh dấu chưa sẵn sàng để lần sau kiểm tra lại */
function markQdrantDown(err) {
    isQdrantAvailable = false;
    nextQdrantRetryAt = Date.now() + QDRANT_RETRY_AFTER_MS;
    if (!qdrantErrorLogged) {
        console.warn(`⚠️ Mất kết nối Qdrant (${err.cause?.code || err.message}). Sẽ tự thử lại sau ${QDRANT_RETRY_AFTER_MS / 1000}s.`);
        qdrantErrorLogged = true;
    }
}

/**
 * Point ID ổn định & không va chạm: UUID dẫn xuất từ messageId (md5, định dạng UUID v3).
 * (Bản cũ băm 32-bit nên trùng ID -> vector của tin này ghi đè tin khác.)
 */
function messageIdToPointId(messageId) {
    const hex = crypto.createHash('md5').update(String(messageId)).digest('hex').split('');
    hex[12] = '3'; // version 3
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variant RFC 4122
    const h = hex.join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Filter chỉ lấy point cùng model embedding. Point cũ (trước khi có trường embedModel)
 * đều được tạo bằng OpenAI nên coi như thuộc model OpenAI.
 */
function embedModelFilter(model) {
    if (model === EMBED_MODEL_OPENAI) {
        return {
            should: [
                { key: 'embedModel', match: { value: model } },
                { is_empty: { key: 'embedModel' } }
            ]
        };
    }
    return { key: 'embedModel', match: { value: model } };
}

/**
 * Lưu Vector vào Qdrant DB
 */
async function upsertMessageVector({ messageId, guildId, channelId, authorId, username, content, createdAt }) {
    if (!(await isQdrantReady())) return false;

    const embedding = await generateEmbedding(content);
    if (!embedding) return false;

    try {
        const res = await qdrantFetch(`/collections/${COLLECTION_NAME}/points`, {
            method: 'PUT',
            body: JSON.stringify({
                points: [{
                    id: messageIdToPointId(messageId),
                    vector: embedding.vector,
                    payload: {
                        messageId,
                        guildId,
                        channelId,
                        authorId,
                        username,
                        content,
                        embedModel: embedding.model,
                        createdAt: new Date(createdAt).toISOString()
                    }
                }]
            })
        });

        if (!res.ok) {
            console.warn('⚠️ Qdrant từ chối upsert:', res.status, (await res.text()).slice(0, 300));
        }
        return res.ok;
    } catch (err) {
        markQdrantDown(err);
        return false;
    }
}

/**
 * Tìm kiếm câu chat tương đồng nhất trong Qdrant
 */
async function searchSimilarMessages({ text, guildId, channelId, allowedChannelIds, topK = 5 }) {
    if (!(await isQdrantReady())) return [];

    const embedding = await generateEmbedding(text);
    if (!embedding) return [];

    try {
        const mustConditions = [embedModelFilter(embedding.model)];
        if (guildId) mustConditions.push({ key: 'guildId', match: { value: guildId } });

        if (Array.isArray(allowedChannelIds) && allowedChannelIds.length > 0) {
            mustConditions.push({ key: 'channelId', match: { any: allowedChannelIds } });
        } else if (channelId) {
            mustConditions.push({ key: 'channelId', match: { value: channelId } });
        }

        const res = await qdrantFetch(`/collections/${COLLECTION_NAME}/points/search`, {
            method: 'POST',
            body: JSON.stringify({
                vector: embedding.vector,
                limit: topK,
                with_payload: true,
                filter: { must: mustConditions }
            })
        });

        if (!res.ok) {
            console.warn('⚠️ Qdrant search lỗi:', res.status, (await res.text()).slice(0, 300));
            return [];
        }

        const data = await res.json();
        return (data.result || []).map(r => ({
            username: r.payload?.username || 'Thành viên',
            content: r.payload?.content || '',
            score: r.score,
            createdAt: r.payload?.createdAt
        }));
    } catch (err) {
        markQdrantDown(err);
        return [];
    }
}

/**
 * Xóa vector cũ hơn VECTOR_RETENTION_DAYS (khớp TTL 60 ngày của ChatMessage trong MongoDB).
 */
async function pruneOldVectors(days = VECTOR_RETENTION_DAYS) {
    if (!(await isQdrantReady())) return false;

    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    try {
        const res = await qdrantFetch(`/collections/${COLLECTION_NAME}/points/delete`, {
            method: 'POST',
            body: JSON.stringify({
                filter: { must: [{ key: 'createdAt', range: { lt: cutoff } }] }
            })
        });
        if (!res.ok) {
            console.warn('⚠️ Không thể dọn vector cũ:', res.status, (await res.text()).slice(0, 300));
            return false;
        }
        console.log(`🧹 [Qdrant] Đã dọn vector cũ hơn ${days} ngày (trước ${cutoff.slice(0, 10)}).`);
        return true;
    } catch (err) {
        markQdrantDown(err);
        return false;
    }
}

module.exports = {
    generateEmbedding,
    upsertMessageVector,
    searchSimilarMessages,
    pruneOldVectors,
    messageIdToPointId,
    embedModelFilter,
    VECTOR_RETENTION_DAYS
};
