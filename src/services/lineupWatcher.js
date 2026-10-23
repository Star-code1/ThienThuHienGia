const Lineup = require('../features/attendance/models/Lineup');
const { notifyLineupAssignment } = require('./notificationService');

let lastCheckedNotifyTimestamp = new Date();
const processedNotifyEvents = new Map(); // eventId -> lastNotifyRequestedAt

/**
 * Lắng nghe và xử lý sự kiện truyền tin đội hình từ MongoDB
 * CHỈ kích hoạt khi người dùng bấm nút "Truyền Tin Đội Hình" trên Web (thông qua trường notifyRequestedAt)
 * Hoàn toàn KHÔNG gửi khi chỉ lưu sơ đồ đội hình thông thường.
 */
async function checkLineupUpdates(client) {
  try {
    // Chỉ tìm các lineup có yêu cầu truyền tin mới kể từ lần check trước
    const requestedLineups = await Lineup.find({
      notifyRequestedAt: { $gt: lastCheckedNotifyTimestamp },
    }).lean();

    if (requestedLineups && requestedLineups.length > 0) {
      for (const lineup of requestedLineups) {
        if (!lineup.notifyRequestedAt) continue;

        const lastProcessed = processedNotifyEvents.get(lineup.eventId);
        const notifyTime = new Date(lineup.notifyRequestedAt).getTime();

        // Kiểm tra tránh xử lý lặp lại cùng một lần bấm nút truyền tin
        if (!lastProcessed || notifyTime > lastProcessed) {
          console.log(`[Lineup Watcher] 📢 Nhận yêu cầu truyền tin đội hình cho event: ${lineup.eventId}`);
          processedNotifyEvents.set(lineup.eventId, notifyTime);

          if (client && client.isReady()) {
            notifyLineupAssignment(client, lineup.eventId, lineup)
              .then((res) => console.log(`[Lineup Watcher] ✅ Đã hoàn tất gửi DM đội hình:`, res))
              .catch((err) => console.error(`[Lineup Watcher] ❌ Lỗi gửi DM đội hình:`, err));
          }
        }
      }
      lastCheckedNotifyTimestamp = new Date();
    }
  } catch (error) {
    console.warn('[Lineup Watcher] Lỗi kiểm tra update Lineup:', error.message);
  }
}

/**
 * Khởi động watcher: Thử MongoDB Change Stream trước, nếu không hỗ trợ thì tự động fallback sang polling chu kỳ 5s
 */
function startLineupWatcher(client) {
  console.log('📡 Khởi động Lineup Watcher (Lắng nghe sự kiện truyền tin qua MongoDB)...');
  lastCheckedNotifyTimestamp = new Date(Date.now() - 5000); // Lùi 5s để đón các event vừa kích hoạt

  // 1. Thử dùng Change Stream của MongoDB Atlas (nhanh tức thì < 100ms)
  try {
    const changeStream = Lineup.watch([], { fullDocument: 'updateLookup' });

    changeStream.on('change', (change) => {
      // Chỉ kích hoạt khi trường notifyRequestedAt được cập nhật trong document
      const updatedFields = change.updateDescription?.updatedFields;
      const isNotifyRequested = updatedFields && 'notifyRequestedAt' in updatedFields && updatedFields.notifyRequestedAt != null;

      if (isNotifyRequested) {
        const doc = change.fullDocument;
        if (doc && doc.eventId && doc.notifyRequestedAt) {
          const notifyTime = new Date(doc.notifyRequestedAt).getTime();
          const lastProcessed = processedNotifyEvents.get(doc.eventId);

          if (!lastProcessed || (notifyTime - lastProcessed) > 3000) {
            console.log(`[Change Stream] ⚡ Nhận yêu cầu truyền tin đội hình cho event: ${doc.eventId}`);
            processedNotifyEvents.set(doc.eventId, notifyTime);
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
