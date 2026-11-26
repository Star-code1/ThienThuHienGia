const test = require('node:test');
const assert = require('node:assert');
const { getWeekEndExpiry } = require('../src/services/eventRoleService');

// Hạn = 00:00 Thứ 2 tuần sau giờ VN (UTC+7) = hết Chủ nhật 23:59:59 giờ VN
const vn = (d) => new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

test('sự kiện Thứ 6 -> hết Chủ nhật cùng tuần', () => {
  assert.strictEqual(vn(getWeekEndExpiry('2026-11-27T00:00:00Z')), '2026-11-30 00:00:00');
});
test('sự kiện Chủ nhật -> hết chính Chủ nhật đó', () => {
  assert.strictEqual(vn(getWeekEndExpiry('2026-11-29T00:00:00Z')), '2026-11-30 00:00:00');
});
test('sự kiện Thứ 2 -> hết Chủ nhật cuối tuần đó', () => {
  assert.strictEqual(vn(getWeekEndExpiry('2026-11-23T00:00:00Z')), '2026-11-30 00:00:00');
});
test('tính ngày theo giờ VN: 18h UTC Thứ 7 đã là Chủ nhật bên VN', () => {
  assert.strictEqual(vn(getWeekEndExpiry('2026-11-28T18:00:00Z')), '2026-11-30 00:00:00');
});
test('ngày không hợp lệ -> null', () => {
  assert.strictEqual(getWeekEndExpiry('abc'), null);
});
