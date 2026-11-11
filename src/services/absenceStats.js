/**
 * Thống kê số lần vote "Vắng" theo tháng.
 * File này được dùng chung (bản sao giống hệt) giữa Bot Discord và Backend Web.
 *
 * - Tháng được tính theo giờ Việt Nam (UTC+7) dựa trên ngày diễn ra sự kiện.
 * - Mức cảnh báo dựa trên số lần vote Vắng trong tháng:
 *     3 buổi  → "warning" (Nhắc nhở)
 *     ≥4 buổi → "danger"  (Cảnh cáo)
 */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WARNING_THRESHOLD = 3;
const DANGER_THRESHOLD = 4;

const pad2 = (n) => String(n).padStart(2, '0');

/** Trả về khoá tháng 'YYYY-MM' theo giờ Việt Nam */
function toMonthKey(date) {
  const d = new Date(new Date(date).getTime() + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function currentMonthKey() {
  return toMonthKey(new Date());
}

/** Chuẩn hoá input 'YYYY-MM' | 'MM/YYYY' | 'M/YYYY' | 'M' → 'YYYY-MM' (null nếu sai) */
function parseMonthKey(input) {
  if (!input) return currentMonthKey();
  const s = String(input).trim();
  let y;
  let m;
  let match = s.match(/^(\d{4})-(\d{1,2})$/);
  if (match) {
    y = +match[1];
    m = +match[2];
  } else if ((match = s.match(/^(\d{1,2})[/-](\d{4})$/))) {
    m = +match[1];
    y = +match[2];
  } else if ((match = s.match(/^(\d{1,2})$/))) {
    m = +match[1];
    y = +currentMonthKey().slice(0, 4);
  } else {
    return null;
  }
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${pad2(m)}`;
}

/** Khoảng thời gian UTC [start, end) của một tháng theo giờ Việt Nam */
function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - VN_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - VN_OFFSET_MS);
  return { start, end };
}

function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `Tháng ${+m}/${y}`;
}

function getAbsenceLevel(absentCount) {
  if (absentCount >= DANGER_THRESHOLD) return 'danger';
  if (absentCount >= WARNING_THRESHOLD) return 'warning';
  return null;
}

function getAutoNote(absentCount) {
  if (absentCount >= DANGER_THRESHOLD) {
    return `🚨 Cảnh cáo: vắng ${absentCount} buổi trong tháng — cần Đương Gia/Đường Chủ trao đổi trực tiếp.`;
  }
  if (absentCount >= WARNING_THRESHOLD) {
    return `⚠️ Nhắc nhở: vắng ${absentCount} buổi trong tháng — đệ tử nên sắp xếp thời gian tham chiến.`;
  }
  return '';
}

const eventTime = (e) => new Date(e.date || e.createdAt).getTime();

/**
 * @param {object} deps
 * @param {import('mongoose').Model} deps.Event
 * @param {import('mongoose').Model} deps.Attendance
 * @param {import('mongoose').Model} deps.User
 * @param {import('mongoose').Model} deps.AbsenceNote
 * @param {import('mongoose').Model} [deps.Note]  Ghi chú sự kiện (dùng làm lý do vắng)
 * @param {string} deps.channelId  Kênh điểm danh bang chiến được tính
 * @param {string} deps.roleId     Role bang chúng (để tính "không vote")
 */
function createAbsenceStats({ Event, Attendance, User, AbsenceNote, Note, channelId, roleId }) {
  async function findEventsInRange(start, end) {
    // Một số event cũ có thể thiếu `date` → fallback createdAt
    const events = await Event.find({
      channelId,
      $or: [
        { date: { $gte: start, $lt: end } },
        { date: null, createdAt: { $gte: start, $lt: end } },
      ],
    }).lean();
    return events.sort((a, b) => eventTime(a) - eventTime(b));
  }

  /** Chi tiết một tháng: từng thành viên vắng bao nhiêu buổi, buổi nào, lý do, ghi chú */
  async function getMonthlyDetail(monthKey) {
    const { start, end } = monthRange(monthKey);
    const events = await findEventsInRange(start, end);
    const eventIds = events.map((e) => e.messageId);
    const eventById = new Map(events.map((e) => [e.messageId, e]));

    const [attendances, roleMembers, leaderNotes, eventNotes] = await Promise.all([
      eventIds.length ? Attendance.find({ eventId: { $in: eventIds } }).lean() : [],
      User.find({ roles: roleId, inGuild: true }).lean(),
      AbsenceNote.find({ month: monthKey }).lean(),
      Note && eventIds.length ? Note.find({ eventId: { $in: eventIds } }).lean() : [],
    ]);

    const roleMemberIds = new Set(roleMembers.map((u) => u.discordId));
    const absentUserIds = attendances.filter((a) => a.status === 'absent').map((a) => a.userId);
    const extraUsers = await User.find({
      discordId: { $in: absentUserIds.filter((id) => !roleMemberIds.has(id)) },
    }).lean();
    const userById = new Map([...roleMembers, ...extraUsers].map((u) => [u.discordId, u]));

    const reasonsByKey = new Map();
    for (const n of eventNotes) {
      const key = `${n.eventId}:${n.userId}`;
      if (!reasonsByKey.has(key)) reasonsByKey.set(key, []);
      reasonsByKey.get(key).push(n.content);
    }
    const noteByUser = new Map(leaderNotes.map((n) => [n.userId, n]));

    const members = new Map();
    const ensure = (userId, fallback = {}) => {
      if (!members.has(userId)) {
        const u = userById.get(userId) || {};
        members.set(userId, {
          userId,
          username: u.username || fallback.username || '',
          displayName: u.displayName || u.nickname || u.globalName || fallback.displayName || u.username || fallback.username || userId,
          className: u.className || fallback.className || 'Chưa rõ',
          avatar: u.avatar || '',
          absentCount: 0,
          unvotedCount: 0,
          noShowCount: 0,
          absentEvents: [],
        });
      }
      return members.get(userId);
    };

    const votedByEvent = new Map(eventIds.map((id) => [id, new Set()]));
    for (const att of attendances) {
      votedByEvent.get(att.eventId)?.add(att.userId);
      const ev = eventById.get(att.eventId);
      if (att.status === 'absent') {
        const m = ensure(att.userId, att);
        m.absentCount++;
        m.absentEvents.push({
          eventId: att.eventId,
          title: ev?.title || '',
          date: ev?.date || ev?.createdAt || null,
          votedAt: att.timestamp || null,
          reasons: reasonsByKey.get(`${att.eventId}:${att.userId}`) || [],
        });
      } else if (att.noShow && roleMemberIds.has(att.userId)) {
        ensure(att.userId, att).noShowCount++;
      }
    }

    // Không vote: chỉ tính với bang chúng có role, sự kiện diễn ra sau ngày vào bang
    for (const u of roleMembers) {
      const joined = u.joinedAt ? new Date(u.joinedAt).getTime() : 0;
      let unvoted = 0;
      for (const ev of events) {
        if (votedByEvent.get(ev.messageId).has(u.discordId)) continue;
        if (joined && joined > eventTime(ev)) continue;
        unvoted++;
      }
      if (unvoted > 0) ensure(u.discordId).unvotedCount = unvoted;
    }

    const list = Array.from(members.values()).map((m) => {
      const note = noteByUser.get(m.userId);
      m.absentEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
      return {
        ...m,
        level: getAbsenceLevel(m.absentCount),
        autoNote: getAutoNote(m.absentCount),
        leaderNote: note
          ? { content: note.content, updatedBy: note.updatedBy, updatedAt: note.updatedAt }
          : null,
      };
    });

    list.sort((a, b) =>
      b.absentCount - a.absentCount ||
      b.unvotedCount - a.unvotedCount ||
      b.noShowCount - a.noShowCount ||
      a.displayName.localeCompare(b.displayName, 'vi')
    );

    const flagged = list.filter((m) => m.level);
    return {
      month: monthKey,
      monthLabel: formatMonthLabel(monthKey),
      thresholds: { warning: WARNING_THRESHOLD, danger: DANGER_THRESHOLD },
      totalEvents: events.length,
      events: events.map((e) => ({ messageId: e.messageId, title: e.title, date: e.date || e.createdAt })),
      totalAbsentVotes: list.reduce((s, m) => s + m.absentCount, 0),
      totalUnvoted: list.reduce((s, m) => s + m.unvotedCount, 0),
      membersWithAbsence: list.filter((m) => m.absentCount > 0).length,
      warningCount: flagged.filter((m) => m.level === 'warning').length,
      dangerCount: flagged.filter((m) => m.level === 'danger').length,
      members: list,
    };
  }

  /** Tổng quan N tháng gần nhất (tính đến tháng `endMonth`) */
  async function getMonthlyOverview({ months = 6, endMonth = currentMonthKey() } = {}) {
    const count = Math.min(Math.max(parseInt(months, 10) || 6, 1), 24);
    const firstMonth = shiftMonth(endMonth, -(count - 1));
    const { start } = monthRange(firstMonth);
    const { end } = monthRange(endMonth);

    const events = await findEventsInRange(start, end);
    const monthByEvent = new Map(events.map((e) => [e.messageId, toMonthKey(e.date || e.createdAt)]));
    const absents = events.length
      ? await Attendance.find({ eventId: { $in: [...monthByEvent.keys()] }, status: 'absent' }).lean()
      : [];

    const buckets = new Map();
    for (let i = 0; i < count; i++) {
      const key = shiftMonth(firstMonth, i);
      buckets.set(key, { month: key, monthLabel: formatMonthLabel(key), totalEvents: 0, totalAbsentVotes: 0, perUser: new Map() });
    }
    for (const ev of events) {
      const b = buckets.get(monthByEvent.get(ev.messageId));
      if (b) b.totalEvents++;
    }
    for (const att of absents) {
      const b = buckets.get(monthByEvent.get(att.eventId));
      if (!b) continue;
      b.totalAbsentVotes++;
      b.perUser.set(att.userId, (b.perUser.get(att.userId) || 0) + 1);
    }

    return Array.from(buckets.values()).map(({ perUser, ...b }) => {
      const counts = [...perUser.values()];
      return {
        ...b,
        membersWithAbsence: counts.length,
        warningCount: counts.filter((c) => getAbsenceLevel(c) === 'warning').length,
        dangerCount: counts.filter((c) => getAbsenceLevel(c) === 'danger').length,
      };
    });
  }

  async function setLeaderNote({ month, userId, content, updatedBy }) {
    const text = String(content || '').trim();
    if (!text) {
      await AbsenceNote.deleteOne({ month, userId });
      return null;
    }
    return AbsenceNote.findOneAndUpdate(
      { month, userId },
      { content: text.slice(0, 500), updatedBy: updatedBy || 'Quản Trị Viên', updatedAt: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  }

  return { getMonthlyDetail, getMonthlyOverview, setLeaderNote };
}

module.exports = {
  WARNING_THRESHOLD,
  DANGER_THRESHOLD,
  toMonthKey,
  currentMonthKey,
  parseMonthKey,
  monthRange,
  shiftMonth,
  formatMonthLabel,
  getAbsenceLevel,
  getAutoNote,
  createAbsenceStats,
};
