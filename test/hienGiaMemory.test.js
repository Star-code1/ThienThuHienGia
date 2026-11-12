const test = require('node:test');
const assert = require('node:assert');
const { escapeRegex, containsName, parseMemberAliases, findMentionedMembers } = require('../src/shared/utils/memberMatch');
const { messageIdToPointId, embedModelFilter } = require('../src/services/qdrantService');
const { buildSummaryTranscript } = require('../src/services/memoryService');
const { callMultiProviderAI, _cooldowns } = require('../src/services/aiProviders');

const member = (id, displayName, username = displayName.toLowerCase()) => ({ id, displayName, user: { username } });

test('escapeRegex: tên có ký tự đặc biệt dùng được trong RegExp', () => {
    const name = 'Kiếm (Vô) Ảnh*[VIP]';
    assert.ok(new RegExp(escapeRegex(name)).test(`hỏi về ${name} nè`));
});

test('containsName: khớp nguyên từ, kể cả chữ có dấu', () => {
    assert.ok(containsName('Hiền giả ơi, Mộng Vân dạo này sao rồi?', 'mộng vân'));
    assert.ok(containsName('rắn đâu rồi', 'rắn'));
    assert.ok(!containsName('anh em ơi', 'anh e'), 'không khớp giữa chừng một từ');
    assert.ok(!containsName('rắn rỏi lên', 'rắn rỏi lê'));
});

test('containsName: bỏ qua tên quá ngắn', () => {
    assert.ok(!containsName('a b c', 'a'));
    assert.ok(!containsName('an toàn không', 'an'));
});

test('parseMemberAliases', () => {
    const map = parseMemberAliases('123:rắn|chú rắn|snake; 456:Boss ;bad;abc:x');
    assert.deepStrictEqual(map.get('123'), ['rắn', 'chú rắn', 'snake']);
    assert.deepStrictEqual(map.get('456'), ['Boss']);
    assert.strictEqual(map.size, 2);
});

test('findMentionedMembers: tên ngắn không làm khớp bừa, alias hoạt động', () => {
    const members = [member('1', 'An'), member('2', 'Mộng Vân'), member('3', 'Snake King')];
    const aliases = parseMemberAliases('3:rắn|chú rắn');
    const r = findMentionedMembers('chú rắn với Mộng Vân an toàn không?', members, aliases);
    assert.deepStrictEqual(r.userIds.sort(), ['2', '3']);
    assert.ok(r.keywords.includes('Mộng Vân'));
    assert.ok(r.keywords.includes('rắn'));
    assert.ok(!r.keywords.includes('An'));
});

test('findMentionedMembers: giới hạn tối đa 5 thành viên', () => {
    const members = Array.from({ length: 8 }, (_, i) => member(String(i), `ten${i}`));
    const q = members.map(m => m.displayName).join(' ');
    assert.strictEqual(findMentionedMembers(q, members, new Map()).userIds.length, 5);
});

test('messageIdToPointId: UUID ổn định, không trùng', () => {
    const a = messageIdToPointId('1300000000000000001');
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.strictEqual(a, messageIdToPointId('1300000000000000001'));
    const ids = new Set();
    for (let i = 0; i < 100000; i++) ids.add(messageIdToPointId(String(1300000000000000000n + BigInt(i))));
    assert.strictEqual(ids.size, 100000);
});

test('embedModelFilter: point cũ không có embedModel tính là OpenAI, Gemini thì tách riêng', () => {
    assert.ok(embedModelFilter('openai/text-embedding-3-small').should);
    assert.deepStrictEqual(embedModelFilter('gemini-embedding-001@1536'), { key: 'embedModel', match: { value: 'gemini-embedding-001@1536' } });
});

test('buildSummaryTranscript: chỉ tính các tin thực sự nằm trong budget', () => {
    const msgs = Array.from({ length: 500 }, (_, i) => ({ username: 'u', content: 'x'.repeat(50) + i }));
    const { lines, includedCount } = buildSummaryTranscript(msgs, 1000);
    assert.strictEqual(lines.length, includedCount);
    assert.ok(includedCount > 0 && includedCount < 500);
    assert.ok(lines.join('\n').length <= 1000);
});

test('buildSummaryTranscript: tin quá dài bị cắt, luôn lấy ít nhất 1 tin', () => {
    const { lines, includedCount } = buildSummaryTranscript([{ username: 'u', content: 'y'.repeat(5000) }], 100);
    assert.strictEqual(includedCount, 1);
    assert.ok(lines[0].length < 500);
});

test('callMultiProviderAI: dừng khi hết deadline thay vì thử hết pool', async () => {
    _cooldowns.clear();
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    let calls = 0;
    // Mỗi request "treo" tới khi bị abort
    global.fetch = (url, opts) => {
        calls++;
        return new Promise((_, reject) => opts.signal.addEventListener('abort', () => {
            const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
        }));
    };
    const started = Date.now();
    try {
        await assert.rejects(callMultiProviderAI({ userPrompt: 'hi', deadlineMs: 4000 }));
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 5000, `mất ${elapsed}ms, vượt deadline`);
        assert.strictEqual(calls, 1, 'chỉ đủ thời gian cho 1 request');
    } finally {
        global.fetch = originalFetch;
        process.env = originalEnv;
        _cooldowns.clear();
    }
});
