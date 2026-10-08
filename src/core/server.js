const express = require('express');
const { notifyLineupAssignment } = require('../services/notificationService');

function startServer(client) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/', (req, res) => {
    res.send('Thien Thu Hien Gia Discord Bot is running!');
  });

  // Health check API
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      botReady: client ? client.isReady() : false,
      botUser: client?.user ? client.user.tag : null,
      uptime: process.uptime(),
    });
  });

  // POST /api/notify-lineup: Gọi từ Backend khi lưu sơ đồ đội hình
  app.post('/api/notify-lineup', async (req, res) => {
    try {
      const { eventId, lineup } = req.body;
      if (!eventId || !lineup) {
        return res.status(400).json({ success: false, message: 'Thiếu eventId hoặc lineup data.' });
      }

      if (!client || !client.isReady()) {
        return res.status(503).json({ success: false, message: 'Discord Bot chưa sẵn sàng.' });
      }

      // Xử lý gửi tin nhắn bất đồng bộ trong background để không block response
      notifyLineupAssignment(client, eventId, lineup)
        .then((result) => {
          console.log(`[Server API] Đã xử lý gửi DM đội hình cho event ${eventId}:`, result);
        })
        .catch((err) => {
          console.error(`[Server API] Lỗi gửi DM đội hình:`, err);
        });

      return res.json({
        success: true,
        message: 'Đã tiếp nhận yêu cầu gửi thông báo đội hình đến các thành viên.',
      });
    } catch (error) {
      console.error('[Server API] Lỗi endpoint /api/notify-lineup:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });

  // Cấu hình PORT: Ưu tiên BOT_PORT để không xung đột với Backend (mặc định 3001)
  const PORT = process.env.BOT_PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🌐 Bot Web API server listening on port ${PORT}`);
  });
}

module.exports = { startServer };
