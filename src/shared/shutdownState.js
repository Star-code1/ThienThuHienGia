/**
 * Trạng thái tắt bot êm: khi nhận SIGTERM, game cho các ván đang chơi HOÀN THÀNH rồi mới huỷ phần còn lại.
 */
const DRAIN_MS = Number(process.env.GAME_DRAIN_MS) || 20_000;

let startedAt = 0;

/** Bắt đầu giai đoạn tắt: mọi game ngừng nhận ván/cược mới. */
function begin() { if (!startedAt) startedAt = Date.now(); }
const isDraining = () => startedAt > 0;
/** Mốc thời gian (ms) mà sau đó ván nào chưa xong sẽ bị huỷ + hoàn tiền. */
const deadline = () => (startedAt || Date.now()) + DRAIN_MS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Cho test. */
function _reset() { startedAt = 0; }

const MAINTENANCE_TEXT = '🛠️ Hiền Giả đang chuẩn bị khởi động lại, tạm dừng nhận ván/cược mới. Đạo hữu thử lại sau ít phút nhé!';

module.exports = { DRAIN_MS, begin, isDraining, deadline, sleep, _reset, MAINTENANCE_TEXT };
