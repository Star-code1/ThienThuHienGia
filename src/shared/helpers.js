/**
 * Chuyển status code thành label hiển thị
 */
function statusLabel(status) {
    const map = {
        present:   '✅ Có mặt',
        bench:     '🪑 Bench',
        late:      '⏰ Muộn',
        tentative: '⚖️ Dự kiến',
        absent:    '❌ Vắng',
    };
    return map[status] || status;
}

module.exports = { statusLabel };
