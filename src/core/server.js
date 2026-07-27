const express = require('express');

function startServer() {
    const app = express();
    app.get('/', (req, res) => {
        res.send('Bot is running');
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🌐 Web server listening on port ${PORT}`);
    });
}

module.exports = { startServer };
