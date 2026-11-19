/**
 * Nguồn: wikinghichthuyhan.com (Wiki Nghịch Thủy Hàn tiếng Việt).
 * Chủ trang đã cho phép Thiên Thư Môn nạp nội dung cho Hiền giả.
 */
const BASE = 'https://wikinghichthuyhan.com';
const SOURCE = 'vnwiki';
const USER_AGENT = 'ThienThuHienGia-DiscordBot/1.0 (knowledge sync; permitted by site owner)';

const decode = (s) => s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.text();
}

/** Danh sách URL bài viết (bỏ trang chủ, trang chat, trang danh mục). */
async function listUrls() {
    const xml = await fetchText(`${BASE}/sitemap.xml`);
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]).trim());
    const articles = [...new Set(urls)].filter((u) => {
        const path = u.replace(BASE, '');
        return /^\/(wiki|luu-phai)\/[^/]+$/.test(path) && !path.startsWith('/wiki/category');
    });
    // /luu-phai/to-van và /luu-phai/build-to-van là cùng một bài build -> giữ bản build-*
    const set = new Set(articles);
    return articles.filter((u) => {
        const m = /\/luu-phai\/(?!build-)([^/]+)$/.exec(u);
        return !(m && set.has(`${BASE}/luu-phai/build-${m[1]}`));
    });
}

// Đoạn quảng bá chatbot của trang và các khối điều hướng — không phải kiến thức
const CUT_MARKERS = ['Cần hướng dẫn chi tiết hơn?', 'Bài viết liên quan'];
const DROP_LINE = /^(Tóm tắt từ cơ sở tri thức|Hỏi Tiểu Hàn.*|←.*|.*→)$/;

/** Vị trí ngay sau thẻ </div> đóng tương ứng với thẻ <div mở tại `start`. */
function matchingDivEnd(html, start) {
    const re = /<div\b|<\/div>/g;
    re.lastIndex = start + 4;
    let depth = 1;
    let m;
    while ((m = re.exec(html))) {
        depth += m[0] === '</div>' ? -1 : 1;
        if (depth === 0) return m.index + 6;
    }
    return -1;
}

/**
 * Next.js gửi một phần nội dung "tải sau": trong câu chỉ có <template id="P:4">, còn nội dung thật
 * nằm cuối trang trong <div hidden id="S:4">. Ghép lại để tên kỹ năng/nội công không bị rơi khỏi câu.
 */
function resolveStreamedSegments(html) {
    const segments = new Map();
    let out = '';
    let pos = 0;
    const re = /<div hidden id="S:([0-9a-z]+)">/g;
    let m;
    while ((m = re.exec(html))) {
        const end = matchingDivEnd(html, m.index);
        if (end < 0) break;
        segments.set(m[1], html.slice(m.index + m[0].length, end - 6));
        out += html.slice(pos, m.index);
        pos = end;
        re.lastIndex = end;
    }
    out += html.slice(pos);
    // Nội dung tải sau có thể lồng chỗ trống khác -> thay vài vòng
    for (let i = 0; i < 5 && /<template id="[PB]:/.test(out); i++) {
        out = out.replace(/<template id="[PB]:([0-9a-z]+)"><\/template>/g, (_, id) => segments.get(id) ?? '');
    }
    return out;
}

/** Rút phần nội dung chính của 1 trang HTML thành văn bản thuần, giữ xuống dòng. */
function extractArticle(rawHtml) {
    const html = resolveStreamedSegments(rawHtml);
    const h1 = html.indexOf('<h1');
    if (h1 < 0) return null;
    let body = html.slice(h1);
    const footer = body.search(/<footer[\s>]/);
    if (footer > 0) body = body.slice(0, footer);

    body = body
        .replace(/<(script|style|svg|noscript)[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<(h[1-6]|p|li|tr|br|div|section|article|table|blockquote)[^>]*>/g, '\n')
        .replace(/<\/(td|th)>/g, ' | ')
        .replace(/<[^>]+>/g, ' ');
    let text = decode(body).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();

    const title = text.split('\n')[0].trim();

    // Danh sách "Tên gọi khác" giúp tìm kiếm theo nhiều cách gọi — giữ lại gọn trong 1 dòng
    let aliases = '';
    const aliasMatch = /Tên gọi khác \(\s*\d+\s*\)\n([\s\S]*?)(?:\nBài viết liên quan|$)/.exec(text);
    if (aliasMatch) {
        aliases = aliasMatch[1].split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 15).join('; ');
    }

    for (const marker of CUT_MARKERS) {
        const i = text.indexOf(marker);
        if (i > 0) text = text.slice(0, i);
    }
    const lines = text.split('\n')
        .map((l) => l.trim())
        // "4 tên gọi · Cập nhật: 6/5/2026 · TN_04132_..." -> "Cập nhật: 6/5/2026"
        .map((l) => (/^\d+ tên gọi · /.test(l) ? (/Cập nhật: [\d/]+/.exec(l)?.[0] || '') : l))
        .filter((l) => l && !DROP_LINE.test(l));
    const content = lines.slice(1).join('\n').trim();

    return { title, content: aliases ? `${content}\nTên gọi khác: ${aliases}` : content };
}

async function fetchArticle(url) {
    const html = await fetchText(url);
    const article = extractArticle(html);
    if (!article || !article.title) return null;
    return { url, source: SOURCE, ...article };
}

module.exports = { SOURCE, BASE, listUrls, fetchArticle, extractArticle };
