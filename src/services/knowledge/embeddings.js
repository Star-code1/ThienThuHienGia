/**
 * Embedding cho kho kiến thức game — Cloudflare Workers AI @cf/baai/bge-m3 (đa ngôn ngữ, miễn phí
 * trong hạn mức ngày của tài khoản). Tách riêng khỏi embedding chat (qdrantService).
 *
 * Vì sao không dùng Gemini: gói miễn phí tính MỖI đoạn là 1 lượt (100 đoạn/phút, ~1.000/ngày),
 * không đủ để nạp hàng chục nghìn đoạn wiki.
 */
const MODEL = '@cf/baai/bge-m3';
const EMBED_MODEL = 'cf-bge-m3';
const VECTOR_SIZE = 1024;
const MAX_BATCH = 50;
const MAX_CHARS = 4000; // bge-m3 nhận tối đa ~8k token, cắt cho an toàn
const TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hết hạn mức miễn phí trong ngày — dừng nạp, chạy lại hôm sau. */
class QuotaExhaustedError extends Error {}

function retryDelayMs(retryAfterHeader, attempt) {
    const s = Number(retryAfterHeader);
    const base = Number.isFinite(s) && s > 0 ? s * 1000 : 0;
    return Math.max(base, Math.min(60_000, 2000 * 2 ** attempt)) + 500;
}

async function runModel(texts, { retries = 6, onWait } = {}) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) throw new Error('Thiếu CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');

    for (let attempt = 0; ; attempt++) {
        let res;
        try {
            res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: texts.map((t) => String(t || '').slice(0, MAX_CHARS)) }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (e) {
            if (attempt >= retries) throw e;
            await sleep(2000 * (attempt + 1));
            continue;
        }
        const body = await res.text();
        if (res.ok) {
            const data = JSON.parse(body).result?.data;
            if (!Array.isArray(data) || data.length !== texts.length || data.some((v) => v?.length !== VECTOR_SIZE)) {
                throw new Error('Cloudflare trả về embedding không hợp lệ');
            }
            return data;
        }
        // 4006: đã dùng hết hạn mức neuron miễn phí trong ngày
        if (/4006|daily free allocation|neurons/i.test(body) && res.status === 429) {
            throw new QuotaExhaustedError('Đã hết hạn mức Cloudflare AI miễn phí hôm nay — chạy lại vào ngày mai để nạp tiếp.');
        }
        const retriable = res.status === 429 || res.status >= 500;
        if (!retriable || attempt >= retries) {
            const err = new Error(`Cloudflare embed ${res.status}: ${body.slice(0, 300)}`);
            err.status = res.status;
            throw err;
        }
        const wait = retryDelayMs(res.headers.get('retry-after'), attempt);
        if (onWait) onWait(res.status, wait);
        await sleep(wait);
    }
}

/** Embedding nhiều đoạn văn để lưu (tự chia lô). */
async function embedDocuments(texts, opts = {}) {
    const out = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
        out.push(...await runModel(texts.slice(i, i + MAX_BATCH), opts));
    }
    return out;
}

/** Embedding câu hỏi khi tra cứu — không retry để không làm chậm câu trả lời. */
async function embedQuery(text) {
    const [v] = await runModel([text], { retries: 0 });
    return v;
}

module.exports = { EMBED_MODEL, VECTOR_SIZE, QuotaExhaustedError, embedDocuments, embedQuery, _retryDelayMs: retryDelayMs };
