const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');

const FEATURES_DIR = path.join(__dirname, '..', 'features');
const EVENTS_DIR = path.join(__dirname, '..', 'events');

/**
 * Scan features/ và đăng ký commands, interactions, events
 */
function loadFeatures(client) {
    const featureDirs = fs.readdirSync(FEATURES_DIR).filter(f =>
        fs.statSync(path.join(FEATURES_DIR, f)).isDirectory()
    );

    for (const dir of featureDirs) {
        const featurePath = path.join(FEATURES_DIR, dir, 'index.js');
        if (!fs.existsSync(featurePath)) continue;

        const feature = require(featurePath);

        // Đăng ký commands
        if (feature.commands) {
            for (const cmd of feature.commands) {
                client.commands.set(cmd.data.name, cmd);
                console.log(`  📦 Command: /${cmd.data.name} (${dir})`);
            }
        }

        // Đăng ký interaction handlers (by customId prefix)
        if (feature.interactions) {
            for (const [prefix, handler] of Object.entries(feature.interactions)) {
                client.interactions.set(prefix, handler);
            }
        }

        // Đăng ký events
        if (feature.events) {
            for (const event of feature.events) {
                if (event.once) {
                    client.once(event.name, (...args) => event.execute(...args));
                } else {
                    client.on(event.name, (...args) => event.execute(...args));
                }
                console.log(`  📡 Event: ${event.name} (${dir})`);
            }
        }

        // Hook dọn dẹp khi bot tắt (huỷ ván, hoàn tiền cược...)
        if (typeof feature.onShutdown === 'function') {
            client.shutdownHooks.push({ name: dir, fn: feature.onShutdown });
        }

        // Liệt kê bàn chơi đang mở (cho /banchoi)
        if (typeof feature.listRooms === 'function') {
            client.roomListers.push({ name: dir, fn: feature.listRooms });
        }

        console.log(`✅ Feature loaded: ${dir}`);
    }
}

/**
 * Chạy mọi hook dọn dẹp của features (song song, có giới hạn thời gian)
 */
async function runShutdownHooks(client, timeoutMs = 15000) {
    const hooks = client.shutdownHooks || [];
    const all = Promise.allSettled(hooks.map(async ({ name, fn }) => {
        try {
            await fn(client);
            console.log(`  🧹 Shutdown hook xong: ${name}`);
        } catch (err) {
            console.error(`  ❌ Shutdown hook lỗi (${name}):`, err);
        }
    }));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs).unref())]);
}

/**
 * Đăng ký core events (ready, interactionCreate)
 */
function registerCoreEvents(client) {
    const eventFiles = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.js'));

    for (const file of eventFiles) {
        const event = require(path.join(EVENTS_DIR, file));
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
        console.log(`  🔗 Core Event: ${event.name}`);
    }
}

/**
 * Lấy tất cả commands JSON (cho deploy.js)
 */
function getAllCommandsJSON(client) {
    return Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());
}

module.exports = { loadFeatures, registerCoreEvents, getAllCommandsJSON, runShutdownHooks };
