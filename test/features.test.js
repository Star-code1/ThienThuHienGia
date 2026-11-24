// Kiểm tra mọi feature nạp được và lệnh slash hợp lệ.
// Bắt các lỗi kiểu thiếu import / sai cú pháp trước khi deploy (không cần Discord hay MongoDB).
const test = require('node:test');
const assert = require('node:assert');
const { Client, Collection } = require('discord.js');
const { loadFeatures, getAllCommandsJSON } = require('../src/core/loader');

test('nạp toàn bộ features và lệnh slash', () => {
    const client = new Client({ intents: [] });
    client.commands = new Collection();
    client.interactions = new Collection();
    client.shutdownHooks = [];
    client.roomListers = [];

    const log = console.log;
    console.log = () => {};
    try {
        loadFeatures(client);
    } finally {
        console.log = log;
    }

    const commands = getAllCommandsJSON(client);
    assert.ok(commands.length > 0, 'phải có lệnh slash');
    const names = commands.map((c) => c.name);
    assert.strictEqual(new Set(names).size, names.length, 'tên lệnh bị trùng');
    for (const c of commands) assert.match(c.name, /^[\p{Ll}\p{Lo}\p{N}_-]{1,32}$/u, `tên lệnh không hợp lệ: ${c.name}`);

    for (const name of ['baucua', 'xidach', 'poker']) assert.ok(names.includes(name), `thiếu /${name}`);
    for (const [prefix, handler] of client.interactions) assert.strictEqual(typeof handler, 'function', prefix);
    for (const h of client.shutdownHooks) assert.strictEqual(typeof h.fn, 'function', h.name);
    // Chưa có bàn nào → mọi game trả về danh sách rỗng
    for (const l of client.roomListers) assert.deepStrictEqual(l.fn('kenh-test'), [], l.name);
    assert.ok(names.includes('banchoi'), 'thiếu /banchoi');

    client.destroy();
});
