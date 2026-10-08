const Lineup = require('../features/attendance/models/Lineup');
const { notifyLineupAssignment } = require('./notificationService');

let lastCheckedTimestamp = new Date();
const processedEvents = new Map(); // eventId -> lastUpdatedAt

/**
 * Lắng nghe và xử lý sự kiện lưu đội hình từ MongoDB (hoạt động độc lập không cần HTTP nội bộ)
 */
async function checkLineupUpdates(client) {
  try {
    // Tìm các lineup được cập nhật kể từ lần check trước
    const updatedLineups = await Lineup.find({
      updatedAt: { $gt: lastCheckedTimestamp },
    }).lean();

    if (updatedLineups && updatedLineups.length > 0) {
      for (const lineup of updatedLineups) {
        const lastProcessed = processedEvents.get(lineup.eventId);
        const lineupUpdatedAt = new Date(lineup.updatedAt).getTime();

        // Kiểm tra tránh xử lý lặp lại cùng một lần cập nhật
        if (!lastProcessed || lineupUpdatedAt > lastProcessed) {
          console.log(`[Lineup Watcher] 🔔 Phát hiện sơ đồ đội hình mới được lưu cho event: ${lineup.eventId}`);
          processedEvents.set(lineup.eventId, lineupUpdatedAt);

          if (client && client.isReady()) {
            notifyLineupAssignment(client, lineup.eventId, lineup)
              .then((res) => console.log(`[Lineup Watcher] ✅ Đã hoàn tất gửi DM đội hình:`, res))
              .catch((err) => console.error(`[Lineup Watcher] ❌ Lỗi gửi DM đội hình:`, err));
          }
        }
      }
      lastCheckedTimestamp = new Date();
    }
  } catch (error) {
    console.warn('[Lineup Watcher] Lỗi kiểm tra update Lineup:', error.message);
  }
}

/**
 * Khởi động watcher: Thử MongoDB Change Stream trước, nếu không hỗ trợ thì tự động fallback sang polling chu kỳ 5s
 */
function startLineupWatcher(client) {
  console.log('📡 Khởi động Lineup Watcher (Đồng bộ thời gian thực qua MongoDB)...');
  lastCheckedTimestamp = new Date(Date.now() - 5000); // Lùi 5s để đón các event vừa diễn ra

  // 1. Thử dùng Change Stream của MongoDB Atlas (nhanh tức thì < 100ms)
  try {
    const changeStream = Lineup.watch([], { fullDocument: 'updateLookup' });

    changeStream.on('change', (change) => {
      if (change.operationType === 'insert' || change.operationType === 'update' || change.operationType === 'replace') {
        const doc = change.fullDocument;
        if (doc && doc.eventId) {
          console.log(`[Change Stream] ⚡ Nhận sự kiện lưu đội hình cho event: ${doc.eventId}`);
          const lineupUpdatedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now();
          const lastProcessed = processedEvents.get(doc.eventId);

          if (!lastProcessed || (lineupUpdatedAt - lastProcessed) > 3000) {
            processedEvents.set(doc.eventId, lineupUpdatedAt);
            if (client && client.isReady()) {
              notifyLineupAssignment(client, doc.eventId, doc)
                .then((res) => console.log(`[Change Stream] ✅ Đã gửi DM đội hình:`, res))
                .catch((err) => console.error(`[Change Stream] ❌ Lỗi gửi DM:`, err));
            }
          }
        }
      }
    });

    changeStream.on('error', (err) => {
      console.warn('⚠️ Change Stream gặp lỗi (sẽ sử dụng fallback Polling 5s):', err.message);
    });

    console.log('✅ MongoDB Change Stream đã kích hoạt.');
  } catch (err) {
    console.warn('⚠️ Không thể mở Change Stream, chuyển sang Polling định kỳ:', err.message);
  }

  // 2. Fallback polling an toàn mỗi 5 giây
  setInterval(() => checkLineupUpdates(client), 5000);
}

module.exports = { startLineupWatcher };
