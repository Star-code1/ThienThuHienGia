/**
 * Nạp kiến thức từ một nguồn (vd vnWiki) vào Qdrant.
 * - Chạy theo nhóm bài, gom đoạn của cả nhóm vào ít lần gọi embedding (tiết kiệm hạn mức Gemini).
 * - Có thể dừng giữa chừng rồi chạy lại: bài đã nạp sẽ được bỏ qua (mode 'new'),
 *   hoặc chỉ nạp lại bài có nội dung thay đổi (mode 'refresh').
 */
const crypto = require('crypto');
const KnowledgeDoc = require('../../shared/models/KnowledgeDoc');
const { chunkText } = require('./chunker');
const { embedDocuments } = require('./embeddings');
const { upsertDocs, deleteByUrl } = require('./knowledgeStore');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }));
    return results;
}

/**
 * @param source  module nguồn: { SOURCE, listUrls(), fetchArticle(url) }
 * @param opts.mode 'new' (bỏ qua bài đã nạp) | 'refresh' (tải lại tất cả, chỉ nạp bài đổi nội dung)
 */
async function ingestSource(source, {
    mode = 'new',
    limit = Infinity,
    concurrency = 4,
    groupSize = 40,
    delayMs = 300,
    log = console.log,
} = {}) {
    const stats = { total: 0, skipped: 0, added: 0, updated: 0, unchanged: 0, empty: 0, duplicates: 0, errors: 0, removed: 0, chunks: 0 };
    const allUrls = await source.listUrls();
    const known = new Map((await KnowledgeDoc.find({ source: source.SOURCE }).lean()).map((d) => [d.url, d]));

    // Cùng một bài có thể nằm ở 2 địa chỉ (vd /luu-phai/x và /wiki/x) -> chỉ nạp 1 lần
    const hashOwner = new Map();
    for (const d of known.values()) if (d.status === 'ok' && d.contentHash) hashOwner.set(d.contentHash, d.url);

    const DONE = new Set(['ok', 'empty', 'duplicate']);
    let urls = allUrls;
    if (mode === 'new') {
        urls = allUrls.filter((u) => !DONE.has(known.get(u)?.status));
        stats.skipped = allUrls.length - urls.length;
    }
    urls = urls.slice(0, limit);
    stats.total = urls.length;
    log(`📚 [${source.SOURCE}] ${allUrls.length} bài trên trang, cần xử lý ${urls.length} (bỏ qua ${stats.skipped} đã nạp)`);

    const started = Date.now();
    for (let g = 0; g < urls.length; g += groupSize) {
        const group = urls.slice(g, g + groupSize);

        const fetched = await mapLimit(group, concurrency, async (url) => {
            try {
                const article = await source.fetchArticle(url);
                await sleep(delayMs);
                return { url, article };
            } catch (e) {
                return { url, error: e.message };
            }
        });

        const toEmbed = [];
        for (const { url, article, error } of fetched) {
            if (error) {
                stats.errors++;
                await KnowledgeDoc.updateOne({ url }, { url, source: source.SOURCE, status: 'error', error }, { upsert: true });
                continue;
            }
            const content = article?.content?.trim() || '';
            if (content.length < 20) {
                stats.empty++;
                await KnowledgeDoc.updateOne({ url }, { url, source: source.SOURCE, title: article?.title || '', status: 'empty', error: '', ingestedAt: new Date() }, { upsert: true });
                continue;
            }
            const contentHash = hash(`${article.title}\n${content}`);
            const prev = known.get(url);
            if (prev?.status === 'ok' && prev.contentHash === contentHash) {
                stats.unchanged++;
                continue;
            }
            const owner = hashOwner.get(contentHash);
            if (owner && owner !== url) {
                stats.duplicates++;
                if (prev?.status === 'ok') await deleteByUrl(url);
                await KnowledgeDoc.updateOne({ url }, { url, source: source.SOURCE, title: article.title, contentHash, status: 'duplicate', duplicateOf: owner, chunkCount: 0, error: '', ingestedAt: new Date() }, { upsert: true });
                continue;
            }
            hashOwner.set(contentHash, url);
            const chunks = chunkText(content);
            toEmbed.push({ doc: { url, title: article.title, source: source.SOURCE }, chunks, contentHash, isUpdate: !!prev && prev.status === 'ok' });
        }

        if (toEmbed.length) {
            // Gắn tiêu đề vào mỗi đoạn khi embed để đoạn giữa bài vẫn biết mình thuộc bài nào
            const texts = toEmbed.flatMap((it) => it.chunks.map((c) => `${it.doc.title}\n${c}`));
            const vectors = await embedDocuments(texts, {
                onWait: (status, ms) => log(`   ⏳ Embedding ${status}, chờ ${Math.round(ms / 1000)}s rồi thử lại...`),
            });
            let k = 0;
            for (const it of toEmbed) {
                it.vectors = vectors.slice(k, k + it.chunks.length);
                k += it.chunks.length;
            }
            stats.chunks += await upsertDocs(toEmbed);
            for (const it of toEmbed) {
                if (it.isUpdate) stats.updated++;
                else stats.added++;
                await KnowledgeDoc.updateOne({ url: it.doc.url }, {
                    url: it.doc.url,
                    source: source.SOURCE,
                    title: it.doc.title,
                    contentHash: it.contentHash,
                    chunkCount: it.chunks.length,
                    status: 'ok',
                    error: '',
                    ingestedAt: new Date(),
                }, { upsert: true });
            }
        }

        const done = Math.min(g + groupSize, urls.length);
        const elapsed = (Date.now() - started) / 1000;
        const eta = done ? Math.round((elapsed / done) * (urls.length - done) / 60) : 0;
        log(`   ${done}/${urls.length} • mới ${stats.added} • cập nhật ${stats.updated} • rỗng ${stats.empty} • trùng ${stats.duplicates} • lỗi ${stats.errors} • ${stats.chunks} đoạn • còn ~${eta} phút`);
    }

    // Bài đã bị xóa khỏi trang → xóa khỏi kho (chỉ khi quét toàn bộ)
    if (mode === 'refresh' && limit === Infinity) {
        const live = new Set(allUrls);
        for (const [url, doc] of known) {
            if (live.has(url)) continue;
            if (doc.status === 'ok') await deleteByUrl(url);
            await KnowledgeDoc.deleteOne({ url });
            stats.removed++;
        }
    }

    log(`✅ [${source.SOURCE}] Xong: ${JSON.stringify(stats)}`);
    return stats;
}

module.exports = { ingestSource };
