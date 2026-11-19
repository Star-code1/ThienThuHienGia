/**
 * Cắt bài viết thành các đoạn ~900 ký tự, ưu tiên cắt ở ranh giới dòng, có chồng lấn nhẹ
 * để ý không bị đứt giữa hai đoạn. Mỗi đoạn được gắn tiêu đề bài ở đầu khi embed.
 */
const DEFAULT_SIZE = 900;
const DEFAULT_OVERLAP = 150;

function splitLongLine(line, size) {
    const parts = [];
    let rest = line;
    while (rest.length > size) {
        // cắt ở dấu câu / khoảng trắng gần nhất trước giới hạn
        let cut = Math.max(rest.lastIndexOf('. ', size), rest.lastIndexOf('; ', size), rest.lastIndexOf(', ', size));
        if (cut < size * 0.5) cut = rest.lastIndexOf(' ', size);
        if (cut < size * 0.5) cut = size;
        parts.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
    }
    if (rest.trim()) parts.push(rest.trim());
    return parts;
}

function chunkText(text, { size = DEFAULT_SIZE, overlap = DEFAULT_OVERLAP } = {}) {
    const lines = String(text || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .flatMap((l) => (l.length > size ? splitLongLine(l, size) : [l]));

    const chunks = [];
    let current = [];
    let length = 0;
    for (const line of lines) {
        if (length + line.length + 1 > size && current.length) {
            chunks.push(current.join('\n'));
            // giữ lại vài dòng cuối làm phần chồng lấn
            const keep = [];
            let kept = 0;
            for (let i = current.length - 1; i >= 0 && kept + current[i].length <= overlap; i--) {
                keep.unshift(current[i]);
                kept += current[i].length + 1;
            }
            // phần chồng lấn + dòng mới vẫn quá dài thì bỏ chồng lấn, tránh tạo đoạn trùng lặp
            const fits = kept + line.length + 1 <= size;
            current = fits ? keep : [];
            length = fits ? kept : 0;
        }
        current.push(line);
        length += line.length + 1;
    }
    if (current.length) chunks.push(current.join('\n'));
    return chunks;
}

module.exports = { chunkText };
