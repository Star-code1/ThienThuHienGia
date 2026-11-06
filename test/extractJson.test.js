const test = require('node:test');
const assert = require('node:assert');
const { extractJsonObject } = require('../src/services/aiService');

test('JSON thuần', () => assert.deepStrictEqual(extractJsonObject('{"a":1}'), { a: 1 }));
test('code fence', () => assert.deepStrictEqual(extractJsonObject('Đây:\n```json\n{"a":1}\n```'), { a: 1 }));
test('lời dẫn + think', () => assert.deepStrictEqual(extractJsonObject('<think>x {y}</think> kết quả {"ok":true} xong'), { ok: true }));
test('think dở dang chưa có JSON', () => assert.throws(() => extractJsonObject('<think>đang nghĩ')));
test('trailing comma + key không ngoặc', () => assert.deepStrictEqual(extractJsonObject("{a: 1, 'b': 2,}"), { a: 1, b: 2 }));
test('JSON bị cắt ngắn', () => assert.deepStrictEqual(extractJsonObject('{"word":"abc'), { word: 'abc' }));
test('object truyền thẳng', () => { const o = { z: 1 }; assert.strictEqual(extractJsonObject(o), o); });
test('rỗng', () => assert.throws(() => extractJsonObject('')));
