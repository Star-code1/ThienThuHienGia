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

        console.log(`✅ Feature loaded: ${dir}`);
    }
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

module.exports = { loadFeatures, registerCoreEvents, getAllCommandsJSON };
