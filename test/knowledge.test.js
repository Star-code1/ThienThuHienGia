const test = require('node:test');
const assert = require('node:assert');
const { chunkText } = require('../src/services/knowledge/chunker');
const { extractArticle } = require('../src/services/knowledge/sources/vnWiki');
const { _retryDelayMs } = require('../src/services/knowledge/embeddings');
const { pointId } = require('../src/services/knowledge/knowledgeStore');
const { formatKnowledge, uniqueSources } = require('../src/services/memoryService');

test('chunkText: bài ngắn giữ nguyên 1 đoạn', () => {
    assert.deepStrictEqual(chunkText('Dòng 1\nDòng 2'), ['Dòng 1\nDòng 2']);
});

test('chunkText: bài dài bị cắt, mỗi đoạn không quá giới hạn và không mất nội dung', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Dòng số ${i} nói về Nội Công hệ Thủy và Thần Khí.`);
    const chunks = chunkText(lines.join('\n'), { size: 300, overlap: 60 });
    assert.ok(chunks.length > 5);
    assert.ok(chunks.every((c) => c.length <= 300));
    for (const l of lines) assert.ok(chunks.some((c) => c.includes(l)), l);
});

test('chunkText: dòng cực dài được tách nhỏ', () => {
    const chunks = chunkText('Câu dài. '.repeat(300), { size: 200, overlap: 0 });
    assert.ok(chunks.length > 5 && chunks.every((c) => c.length <= 200));
});

test('extractArticle: lấy tiêu đề, nội dung, tên gọi khác; bỏ quảng bá và bài liên quan', () => {
    const html = `<html><nav>Menu</nav><main>
      <h1 class="x">Yến Tiệc Bang Hội</h1>
      <div>4 tên gọi · Cập nhật: 6/5/2026 · TN_04132_yen_tiec_bang_hoi</div>
      <div>Tóm tắt từ cơ sở tri thức</div>
      <p>Mô tả: Phụ trách tiếp đón &amp; giới thiệu bang hội.</p>
      <div>Cần hướng dẫn chi tiết hơn? Hỏi Tiểu Hàn - chatbot</div>
      <div>Tên gọi khác ( 2 )</div><li>Yến Tiệc Bang Hội</li><li>Người Tiếp Đón</li>
      <div>Bài viết liên quan</div><p>Quân Sư Bang Hội</p>
      </main><footer>© wiki</footer><script>var x=1</script></html>`;
    const a = extractArticle(html);
    assert.strictEqual(a.title, 'Yến Tiệc Bang Hội');
    assert.match(a.content, /Cập nhật: 6\/5\/2026/);
    assert.match(a.content, /Phụ trách tiếp đón & giới thiệu bang hội\./);
    assert.match(a.content, /Tên gọi khác: Yến Tiệc Bang Hội; Người Tiếp Đón/);
    assert.doesNotMatch(a.content, /Tiểu Hàn|Quân Sư|TN_04132|Tóm tắt từ/);
});

test('extractArticle: ghép nội dung Next.js tải sau vào đúng chỗ trong câu', () => {
    const html = `<h1>Build</h1><p>Chọn <template id="P:4"></template> / Thông Vi / <template id="P:5"></template>.</p>
      <footer>x</footer>
      <div hidden id="S:4"><a href="/wiki/a">Nhật Nguyệt Lưỡng Nghi</a></div>
      <div hidden id="S:5"><a href="/wiki/b">Diệt Trận</a></div>`;
    assert.match(extractArticle(html).content, /Chọn Nhật Nguyệt Lưỡng Nghi \/ Thông Vi \/ Diệt Trận \./);
});

test('retryDelayMs đọc header Retry-After', () => {
    assert.ok(_retryDelayMs('37', 0) >= 37000);
    assert.ok(_retryDelayMs(null, 0) >= 2000);
});

test('pointId ổn định và khác nhau theo đoạn', () => {
    assert.strictEqual(pointId('u', 0), pointId('u', 0));
    assert.notStrictEqual(pointId('u', 0), pointId('u', 1));
    assert.match(pointId('u', 0), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('formatKnowledge / uniqueSources', () => {
    const items = [
        { url: 'a', title: 'Build Tố Vấn', text: 'Nội Công 3 Thủy' },
        { url: 'a', title: 'Build Tố Vấn', text: 'Thần Khí' },
        { url: 'b', title: 'Phó bản', text: 'Boss 3' },
    ];
    assert.match(formatKnowledge(items), /\[1\] Bài "Build Tố Vấn":\nNội Công 3 Thủy/);
    assert.deepStrictEqual(uniqueSources(items).map((s) => s.url), ['a', 'b']);
    assert.match(formatKnowledge([]), /Không có/);
});
