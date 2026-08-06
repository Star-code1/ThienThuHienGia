/**
 * Modul tiện ích xử lý Tiếng Việt chuẩn Unicode cho Bot
 */

/**
 * Loại bỏ dấu Tiếng Việt (chuyển chuỗi có dấu thành không dấu)
 * @param {string} str 
 * @returns {string}
 */
function removeAccents(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .normalize('NFC');
}

/**
 * Xáo trộn toàn bộ các ký tự của từ/cụm từ Tiếng Việt (chỉ tính chữ cái, bỏ khoảng trắng)
 * Đảm bảo 100% ký tự được giữ nguyên bản (NFC normalized), chính xác dấu câu/dấu thanh.
 * @param {string} word 
 * @returns {string}
 */
function scrambleVietnameseWord(word) {
    if (!word) return '';
    const normalized = word.trim().normalize('NFC');
    
    // Phân tách từng ký tự unicode chuẩn NFC, loại bỏ khoảng trắng
    const charArray = Array.from(normalized).filter(ch => ch.trim().length > 0);
    
    if (charArray.length <= 1) return charArray.join(' ');
    
    let scrambled = [...charArray];
    let attempts = 0;
    
    // Thuật toán Fisher-Yates Shuffle
    while (attempts < 20) {
        for (let i = scrambled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [scrambled[i], scrambled[j]] = [scrambled[j], scrambled[i]];
        }
        // Đảm bảo kết quả xáo trộn không trùng khớp 100% thứ tự ban đầu nếu độ dài > 1
        if (scrambled.join('') !== charArray.join('')) {
            break;
        }
        attempts++;
    }
    
    return scrambled.join(' ');
}

module.exports = {
    removeAccents,
    scrambleVietnameseWord,
};
