const QDRANT_URL = process.env.QDRANT_URL ? process.env.QDRANT_URL.replace(/\/$/, '') : null;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || null;
const COLLECTION_NAME = 'discord_messages';
const VECTOR_SIZE = 768; // Gemini text-embedding-004 vector dimension

let isQdrantAvailable = null;

/**
 * Sinh Embedding cho văn bản bằng Gemini text-embedding-004
 */
async function generateEmbedding(text) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'models/text-embedding-004',
                content: { parts: [{ text }] }
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            console.warn(`⚠️ Lỗi sinh embedding Gemini (${res.status}): ${errText}`);
            return null;
        }

        const data = await res.json();
        const values = data.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
            return values;
        }
    } catch (err) {
        console.warn('⚠️ Lỗi gọi Embedding API:', err.message);
    }
    return null;
}

/**
 * Khởi tạo Collection trong Qdrant nếu chưa tồn tại
 */
async function ensureQdrantCollection() {
    if (!QDRANT_URL) {
        isQdrantAvailable = false;
        return false;
    }

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

        // Check if collection exists
        const checkRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, { headers });
        if (checkRes.ok) {
            isQdrantAvailable = true;
            return true;
        }

        // Create collection if missing
        const createRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                vectors: {
                    size: VECTOR_SIZE,
                    distance: 'Cosine'
                }
            })
        });

        if (createRes.ok) {
            console.log(`✅ Qdrant Collection "${COLLECTION_NAME}" đã sẵn sàng.`);
            isQdrantAvailable = true;
            return true;
        }
    } catch (e) {
        console.warn('⚠️ Không thể kết nối Qdrant Server:', e.message);
    }

    isQdrantAvailable = false;
    return false;
}

/**
 * Lưu Vector vào Qdrant DB
 */
async function upsertMessageVector({ messageId, guildId, channelId, authorId, username, content, createdAt }) {
    if (isQdrantAvailable === false && !QDRANT_URL) return false;
    if (isQdrantAvailable === null) {
        await ensureQdrantCollection();
    }
    if (!isQdrantAvailable) return false;

    const vector = await generateEmbedding(content);
    if (!vector) return false;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

        // Qdrant point ID can be numeric or UUID. Generate a deterministic numeric ID from messageId string hash
        const pointId = stringToPositiveInt(messageId);

        const body = {
            points: [
                {
                    id: pointId,
                    vector,
                    payload: {
                        messageId,
                        guildId,
                        channelId,
                        authorId,
                        username,
                        content,
                        createdAt: new Date(createdAt).toISOString()
                    }
                }
            ]
        };

        const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        return res.ok;
    } catch (err) {
        console.warn('⚠️ Lỗi upsert Vector Qdrant:', err.message);
        return false;
    }
}

/**
 * Tìm kiếm câu chat tương đồng nhất trong Qdrant
 */
async function searchSimilarMessages({ text, guildId, topK = 5 }) {
    if (isQdrantAvailable === false && !QDRANT_URL) return [];
    if (isQdrantAvailable === null) {
        await ensureQdrantCollection();
    }
    if (!isQdrantAvailable) return [];

    const vector = await generateEmbedding(text);
    if (!vector) return [];

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (QDRANT_API_KEY) headers['api-key'] = QDRANT_API_KEY;

        const filter = guildId ? {
            must: [
                { key: 'guildId', match: { value: guildId } }
            ]
        } : undefined;

        const body = {
            vector,
            limit: topK,
            with_payload: true,
            filter
        };

        const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) return [];

        const data = await res.json();
        const results = data.result || [];
        return results.map(r => ({
            username: r.payload?.username || 'Thành viên',
            content: r.payload?.content || '',
            score: r.score,
            createdAt: r.payload?.createdAt
        }));
    } catch (err) {
        console.warn('⚠️ Lỗi search Vector Qdrant:', err.message);
        return [];
    }
}

// Convert string ID (like Discord Snowflake string) to positive 64-bit safe integer for Qdrant numeric point IDs
function stringToPositiveInt(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) + 1;
}

module.exports = {
    generateEmbedding,
    upsertMessageVector,
    searchSimilarMessages
};
