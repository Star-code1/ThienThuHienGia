/**
 * Tiện ích nhận diện thành viên được nhắc tới trong câu hỏi gửi Hiền Giả.
 */

// Tên quá ngắn ("a", "an", "ok") sẽ khớp với gần như mọi câu hỏi -> bỏ qua
const MIN_NAME_LENGTH = 3;
const MAX_MATCHED_MEMBERS = 5;

/** Escape ký tự đặc biệt để dùng chuỗi tùy ý trong RegExp / MongoDB $regex */
function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(str) {
    return String(str || '').normalize('NFC').toLowerCase().trim();
}

/**
 * Câu hỏi có chứa `name` như một từ/cụm từ độc lập không (không dính vào chữ khác).
 * Dùng \p{L}\p{N} thay cho \b vì \b của JS không hiểu chữ có dấu tiếng Việt.
 */
function containsName(query, name) {
    const q = normalize(query);
    const n = normalize(name);
    if (n.length < MIN_NAME_LENGTH) return false;
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(n)}(?![\\p{L}\\p{N}])`, 'u').test(q);
}

/**
 * Đọc biệt danh thân mật từ env MEMBER_ALIASES.
 * Định dạng: "userId:alias1|alias2;userId2:alias3"
 * Ví dụ:     "377331972621467648:rắn|chú rắn|snake"
 * @returns {Map<string, string[]>} userId -> aliases
 */
function parseMemberAliases(raw = process.env.MEMBER_ALIASES || '') {
    const map = new Map();
    for (const entry of raw.split(';')) {
        const idx = entry.indexOf(':');
        if (idx === -1) continue;
        const userId = entry.slice(0, idx).trim();
        const aliases = entry.slice(idx + 1).split('|').map(a => a.trim()).filter(Boolean);
        if (/^\d+$/.test(userId) && aliases.length > 0) map.set(userId, aliases);
    }
    return map;
}

/**
 * Tìm thành viên được nhắc tới trong câu hỏi.
 * @param {string} query
 * @param {Iterable<{id: string, displayName?: string, user?: {username?: string, globalName?: string}}>} members
 * @param {Map<string, string[]>} aliases
 * @returns {{ userIds: string[], keywords: string[] }}
 */
function findMentionedMembers(query, members, aliases = parseMemberAliases()) {
    const matches = []; // { id, keyword, score }

    for (const member of members) {
        const names = [member.displayName, member.user?.username, member.user?.globalName].filter(Boolean);
        const hit = names.filter(n => containsName(query, n));
        const idHit = String(query).includes(member.id);
        if (hit.length > 0 || idHit) {
            const longest = hit.sort((a, b) => b.length - a.length)[0];
            matches.push({
                id: member.id,
                keyword: member.displayName || longest,
                // Ưu tiên tên dài (cụ thể hơn) và khớp theo ID
                score: idHit ? Infinity : (longest || '').length
            });
        }
    }

    const keywords = [];
    for (const [userId, list] of aliases) {
        const hitAliases = list.filter(a => containsName(query, a));
        if (hitAliases.length > 0) {
            matches.push({ id: userId, keyword: null, score: Infinity });
            keywords.push(...list);
        }
    }

    matches.sort((a, b) => b.score - a.score);
    const top = [];
    const seen = new Set();
    for (const m of matches) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        top.push(m);
        if (top.length >= MAX_MATCHED_MEMBERS) break;
    }

    for (const m of top) if (m.keyword) keywords.push(m.keyword);

    return {
        userIds: top.map(m => m.id),
        keywords: Array.from(new Set(keywords.filter(k => normalize(k).length >= MIN_NAME_LENGTH)))
    };
}

module.exports = {
    escapeRegex,
    containsName,
    parseMemberAliases,
    findMentionedMembers,
    MIN_NAME_LENGTH,
    MAX_MATCHED_MEMBERS
};
