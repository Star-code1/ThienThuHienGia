/**
 * Tiểu Hàn — chatbot của wikinghichthuyhan.com (được chủ trang cho phép dùng).
 *
 * Gửi:  POST /api/chat  { messages:[{role,content}], adminKey? }
 * Nhận: luồng SSE, mỗi dòng `data: {type}`:
 *       - content_block_delta { delta:{ type:'text_delta', text } }
 *       - message_stop
 *       Kèm header x-stamina-remaining / x-stamina-max / x-stamina-next-refill-at.
 * Hết lượt (429): body JSON { message, staminaRemaining, staminaMax, nextRefillAt }.
 */
const API_URL = process.env.TIEUHAN_API_URL || 'https://wikinghichthuyhan.com/api/chat';
const SITE_BASE = (process.env.TIEUHAN_SITE_URL || 'https://wikinghichthuyhan.com').replace(/\/$/, '');
const ADMIN_KEY = process.env.TIEUHAN_ADMIN_KEY || '';
const USER_AGENT = 'ThienThuHienGia-DiscordBot/1.0';
const TIMEOUT_MS = 90_000;

/** Hết lượt stamina — mang theo thời điểm hồi lượt để báo người hỏi. */
class StaminaExhaustedError extends Error {
    constructor(stamina) {
        super('Tiểu Hàn đã hết lượt trò chuyện');
        this.name = 'StaminaExhaustedError';
        this.stamina = stamina; // { remaining, max, nextRefillAt }
    }
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Đọc 3 header stamina của phản hồi. */
function readStaminaHeaders(headers) {
    return {
        remaining: num(headers.get('x-stamina-remaining')),
        max: num(headers.get('x-stamina-max')),
        nextRefillAt: num(headers.get('x-stamina-next-refill-at')),
    };
}

/** Đọc 1 dòng SSE, trả về object sự kiện hoặc null. */
function parseSseLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return null;
    try {
        return JSON.parse(payload);
    } catch {
        return null;
    }
}

/**
 * Gửi hội thoại cho Tiểu Hàn, gọi onDelta(textSoFar) mỗi khi có chữ mới.
 * @param {{role:'user'|'assistant'|'system', content:string}[]} messages
 * @returns {Promise<{ answer:string, stamina:{remaining,max,nextRefillAt}, links:{title,url}[] }>}
 * @throws {StaminaExhaustedError} khi hết lượt
 */
async function askTieuHan(messages, { onDelta, signal } = {}) {
    const body = { messages };
    if (ADMIN_KEY) body.adminKey = ADMIN_KEY;

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'User-Agent': USER_AGENT,
            ...(ADMIN_KEY ? { 'x-admin-key': ADMIN_KEY } : {}),
        },
        body: JSON.stringify(body),
        signal: signal || AbortSignal.timeout(TIMEOUT_MS),
    });

    const stamina = readStaminaHeaders(res.headers);

    if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => '');
        let info = null;
        try { info = JSON.parse(raw); } catch { /* không phải JSON */ }
        if (res.status === 429) {
            throw new StaminaExhaustedError({
                remaining: info?.staminaRemaining ?? stamina.remaining ?? 0,
                max: info?.staminaMax ?? stamina.max,
                nextRefillAt: info?.nextRefillAt ?? stamina.nextRefillAt,
            });
        }
        throw new Error(`Tiểu Hàn API ${res.status}: ${(info?.message || raw).slice(0, 200)}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let stopped = false;
    const links = [];
    const seenLinks = new Set();

    const handleLine = (line) => {
        const ev = parseSseLine(line);
        if (!ev) return;
        if (ev.type === 'content_block_delta' && typeof ev.delta?.text === 'string') {
            text += ev.delta.text;
            if (onDelta) onDelta(text);
        } else if (ev.type === 'related_links' && Array.isArray(ev.links)) {
            // URL dạng tương đối "/wiki/..." -> ghép tên miền; bỏ trùng
            for (const l of ev.links) {
                if (!l?.url || seenLinks.has(l.url)) continue;
                seenLinks.add(l.url);
                const url = /^https?:\/\//.test(l.url) ? l.url : SITE_BASE + (l.url.startsWith('/') ? '' : '/') + l.url;
                links.push({ title: l.title || l.url, url, category: l.category || '' });
            }
        } else if (ev.type === 'message_stop') {
            stopped = true;
        } else if (ev.type === 'error') {
            throw new Error(`Tiểu Hàn báo lỗi: ${ev.error?.message || JSON.stringify(ev).slice(0, 200)}`);
        }
    };

    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) handleLine(line);
        if (stopped) break;
    }
    if (buffer) handleLine(buffer);

    if (!text.trim()) throw new Error('Tiểu Hàn không trả lời');
    return { answer: text.trim(), stamina, links };
}

module.exports = { askTieuHan, parseSseLine, readStaminaHeaders, StaminaExhaustedError, hasAdminKey: () => !!ADMIN_KEY };
