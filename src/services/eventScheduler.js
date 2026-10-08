const Event = require('../features/attendance/models/Event');
const {
  NOTIFICATION_CONFIG,
  getEventDateTime,
  notifyUnvotedMembers,
  notifyGameStartingSoon,
  notifyTentativeMembers,
} = require('./notificationService');

const UNVOTED_MILESTONES = [48, 36, 24, 12]; // Các mốc giờ nhắc điểm danh

let schedulerInterval = null;

async function checkAndSendEventNotifications(client) {
  try {
    const now = new Date();

    // Tìm các sự kiện active trong kênh chỉ định
    const activeEvents = await Event.find({
      channelId: NOTIFICATION_CONFIG.TARGET_CHANNEL_ID,
      active: true,
    });

    if (!activeEvents || activeEvents.length === 0) return;

    for (const event of activeEvents) {
      const eventTime = getEventDateTime(event);
      if (!eventTime) continue;

      const diffMs = eventTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      const diffMinutes = diffMs / (1000 * 60);

      // Nếu sự kiện đã kết thúc quá 2 tiếng -> có thể bỏ qua hoặc auto close
      if (diffMinutes < -120) continue;

      let isModified = false;

      // 1. Kiểm tra các mốc nhắc chưa điểm danh (48h, 36h, 24h, 12h)
      if (!event.remindedMilestones) event.remindedMilestones = [];

      for (const milestone of UNVOTED_MILESTONES) {
        if (diffHours <= milestone && diffHours > 0) {
          if (!event.remindedMilestones.includes(milestone)) {
            console.log(`[Scheduler] ⏰ Chạm mốc ${milestone}h trước sự kiện [${event.title}]`);
            await notifyUnvotedMembers(client, event, milestone);
            event.remindedMilestones.push(milestone);
            isModified = true;
          }
        }
      }

      // 4. Kiểm tra mốc nhắc người vote "Chưa chắc chắn" (24h)
      if (diffHours <= 24 && diffHours > 0 && !event.notified24hTentative) {
        console.log(`[Scheduler] ⚖️ Chạm mốc 24h nhắc chốt vote Chưa chắc chắn cho [${event.title}]`);
        await notifyTentativeMembers(client, event, 24);
        event.notified24hTentative = true;
        isModified = true;
      }

      // 3. Kiểm tra mốc nhắc vào game trước 30 phút
      if (diffMinutes <= 30 && diffMinutes > 0 && !event.notified30m) {
        console.log(`[Scheduler] 🔥 Chạm mốc 30 phút nhắc vào game cho [${event.title}]`);
        await notifyGameStartingSoon(client, event, Math.max(1, Math.round(diffMinutes)));
        event.notified30m = true;
        isModified = true;
      }

      if (isModified) {
        await event.save();
      }
    }
  } catch (error) {
    console.error('[Scheduler] Lỗi trong tiến trình quét thông báo sự kiện:', error);
  }
}

function startEventScheduler(client, intervalMs = 60000) {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log('⏰ Khởi động Background Event Scheduler (chu kỳ mỗi 60s)...');
  // Chạy ngay 1 lần sau khi bot start 5s
  setTimeout(() => checkAndSendEventNotifications(client), 5000);

  // Định kỳ lặp lại
  schedulerInterval = setInterval(() => checkAndSendEventNotifications(client), intervalMs);
}

function stopEventScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('🛑 Đã dừng Event Scheduler.');
  }
}

module.exports = {
  startEventScheduler,
  stopEventScheduler,
  checkAndSendEventNotifications,
};
