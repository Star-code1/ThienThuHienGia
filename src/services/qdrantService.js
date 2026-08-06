const QDRANT_URL = process.env.QDRANT_URL ? process.env.QDRANT_URL.replace(/\/$/, '') : null;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || null;
const COLLECTION_NAME = 'discord_messages';
const VECTOR_SIZE = 1536; // OpenAI text-embedding-3-small (qua OpenRouter) dimension

let isQdrantAvailable = null;
let embeddingErrorLogged = false;

/**
 * Sinh Embedding cho văn bản (Ưu tiên OpenRouter text-embedding-3-small, fallback Gemini)
 */
async function generateEmbedding(text) {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    // 1. Thử OpenRouter Embedding (openai/text-embedding-3-small)
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
                body: JSON.stringify({
                    model: 'openai/text-embedding-3-small',
                    input: text
                })
            });

            if (res.ok) {
                const data = await res.json();
                const embedding = data.data?.[0]?.embedding;
                if (Array.isArray(embedding) && embedding.length > 0) {
                    return embedding;
                }
            }
        } catch (e) {
            // Silence error and try next fallback
        }
    }

    // 2. Thử Gemini Embedding
    if (geminiKey) {
        const embeddingModels = ['text-embedding-004', 'embedding-001'];
        for (const modelName of embeddingModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${geminiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: { parts: [{ text }] }
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const values = data.embedding?.values;
                    if (Array.isArray(values) && values.length > 0) {
                        return values;
                    }
                }
            } catch (err) {}
        }
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
            console.log(`✅ Qdrant Collection "${COLLECTION_NAME}" (size: ${VECTOR_SIZE}) đã khởi tạo thành công.`);
            isQdrantAvailable = true;
            return true;
        } else {
            const textErr = await createRes.text();
            console.warn('⚠️ Không thể khởi tạo Qdrant Collection:', textErr);
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
async function searchSimilarMessages({ text, guildId, channelId, allowedChannelIds, topK = 5 }) {
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

        const mustConditions = [];
        if (guildId) mustConditions.push({ key: 'guildId', match: { value: guildId } });

        if (Array.isArray(allowedChannelIds) && allowedChannelIds.length > 0) {
            mustConditions.push({ key: 'channelId', match: { any: allowedChannelIds } });
        } else if (channelId) {
            mustConditions.push({ key: 'channelId', match: { value: channelId } });
        }

        const filter = mustConditions.length > 0 ? { must: mustConditions } : undefined;

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
