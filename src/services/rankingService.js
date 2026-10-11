const Event = require('../features/attendance/models/Event');
const Attendance = require('../features/attendance/models/Attendance');
const User = require('../models/User');

const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || '1515709357856264212';
const TARGET_ROLE_ID = process.env.TARGET_ROLE_ID || '1438967271149146302';

/**
 * Tính toán bảng xếp hạng và điểm công tội của toàn bộ thành viên sở hữu role mục tiêu
 */
async function getGuildRankings({ days = null, targetUserId = null } = {}) {
  // 1. Lấy tất cả sự kiện thuộc kênh mục tiêu
  const eventQuery = { channelId: TARGET_CHANNEL_ID };
  if (days && !isNaN(parseInt(days, 10))) {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - parseInt(days, 10));
    eventQuery.createdAt = { $gte: pastDate };
  }

  const events = await Event.find(eventQuery).sort({ createdAt: -1 }).lean();
  const totalEventsCount = events.length;

  // 2. Lấy danh sách thành viên có role mục tiêu
  const users = await User.find({ roles: TARGET_ROLE_ID, inGuild: true }).lean();
  const eventIds = events.map((e) => e.messageId);

  // 3. Lấy tất cả lượt điểm danh của các sự kiện này
  const allAttendances = await Attendance.find({ eventId: { $in: eventIds } }).lean();

  const eventAttendanceMap = new Map();
  allAttendances.forEach((att) => {
    if (!eventAttendanceMap.has(att.eventId)) {
      eventAttendanceMap.set(att.eventId, new Map());
    }
    eventAttendanceMap.get(att.eventId).set(att.userId, att);
  });

  // Map thống kê từng thành viên
  const membersMap = new Map();
  users.forEach((u) => {
    membersMap.set(u.discordId, {
      userId: u.discordId,
      displayName: u.displayName || u.nickname || u.globalName || u.username,
      username: u.username,
      className: u.className || 'Chưa rõ',
      avatar: u.avatar || '',
      joinedAt: u.joinedAt || null,
      totalEvents: 0,
      attendedCount: 0,
      explicitAbsentCount: 0,
      unvotedCount: 0,
      noShowCount: 0,
      tentativeCount: 0,
      totalAbsentCount: 0,
      reputationScore: 0,
      absenceRate: 0,
    });
  });

  // 4. Đối soát từng Event với từng Member
  for (const event of events) {
    const attMap = eventAttendanceMap.get(event.messageId) || new Map();
    const eventTime = event.date
      ? new Date(event.date).getTime()
      : (event.createdAt ? new Date(event.createdAt).getTime() : 0);

    for (const [userId, member] of membersMap.entries()) {
      const att = attMap.get(userId);
      const memberJoinTime = member.joinedAt ? new Date(member.joinedAt).getTime() : 0;
      const isEventBeforeJoined = memberJoinTime > 0 && eventTime > 0 && memberJoinTime > eventTime;

      if (att) {
        member.totalEvents++;
        if (att.noShow) {
          member.noShowCount++;
          member.totalAbsentCount++;
        } else if (att.status === 'absent') {
          member.explicitAbsentCount++;
          member.totalAbsentCount++;
        } else if (['present', 'bench', 'late'].includes(att.status)) {
          member.attendedCount++;
        } else if (att.status === 'tentative') {
          member.tentativeCount++;
        }
      } else {
        if (isEventBeforeJoined) continue;
        member.totalEvents++;
        member.unvotedCount++;
        member.totalAbsentCount++;
      }
    }
  }

  // 5. Tính tổng điểm và làm tròn
  const rankings = Array.from(membersMap.values()).map((m) => {
    const score = (m.attendedCount * 1) + (m.explicitAbsentCount * -0.5) + (m.unvotedCount * -2) + (m.noShowCount * -3);
    const roundedScore = Math.round(score * 10) / 10;
    const rate = m.totalEvents > 0 ? Math.round((m.totalAbsentCount / m.totalEvents) * 1000) / 10 : 0;
    return {
      ...m,
      reputationScore: roundedScore,
      absenceRate: rate,
    };
  });

  // 6. Sắp xếp từ Cao xuống Thấp
  rankings.sort((a, b) => (
    b.reputationScore - a.reputationScore ||
    b.attendedCount - a.attendedCount ||
    a.totalAbsentCount - b.totalAbsentCount
  ));

  // Gán vị trí rank cho từng người (#1, #2, ...)
  rankings.forEach((m, idx) => {
    m.rank = idx + 1;
  });

  // Top 3 điểm cao nhất
  const topHigh = rankings.slice(0, 3);

  // Top 3 điểm thấp nhất (sắp xếp từ thấp nhất trở lên)
  const lowToHigh = [...rankings].sort((a, b) => (
    a.reputationScore - b.reputationScore ||
    b.totalAbsentCount - a.totalAbsentCount ||
    b.noShowCount - a.noShowCount
  ));
  const topLow = lowToHigh.slice(0, 3);

  // Tìm thông tin của targetUser nếu có yêu cầu
  let targetMember = null;
  if (targetUserId) {
    targetMember = rankings.find((m) => m.userId === targetUserId) || null;
  }

  return {
    totalEvents: totalEventsCount,
    totalMembers: rankings.length,
    topHigh,
    topLow,
    targetMember,
    rankings,
  };
}

module.exports = {
  TARGET_CHANNEL_ID,
  TARGET_ROLE_ID,
  getGuildRankings,
};
