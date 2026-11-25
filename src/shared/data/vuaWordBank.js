/**
 * Ngân hàng từ dự phòng cho Vua Tiếng Việt (đã soát tay: đều là từ ghép 2 tiếng có nghĩa,
 * câu gợi ý KHÔNG chứa tiếng nào của đáp án — test/wordGame.test.js kiểm tra tự động).
 * Dùng khi AI lỗi hoặc sinh ra từ không đạt kiểm định.
 */
const WORD_BANK = [
    // ── Dễ ──
    { level: 'de', word: 'BÀN GHẾ', hint: 'Đồ dùng quen thuộc trong lớp học' },
    { level: 'de', word: 'CON MÈO', hint: 'Thú nuôi chuyên bắt chuột trong nhà' },
    { level: 'de', word: 'MẶT TRỜI', hint: 'Ngôi sao sáng nhất ban ngày' },
    { level: 'de', word: 'BÁNH MÌ', hint: 'Món ăn sáng quen thuộc của người Việt' },
    { level: 'de', word: 'QUÊ HƯƠNG', hint: 'Nơi chôn rau cắt rốn của mỗi người' },
    { level: 'de', word: 'GIA ĐÌNH', hint: 'Mái ấm có cha mẹ và con cái' },
    { level: 'de', word: 'HỌC SINH', hint: 'Người cắp sách tới trường mỗi ngày' },
    { level: 'de', word: 'BẠN BÈ', hint: 'Những người đồng hành, sẻ chia vui buồn' },
    { level: 'de', word: 'MÙA XUÂN', hint: 'Thời điểm cây cối đâm chồi, đón Tết' },
    { level: 'de', word: 'TRÁI TIM', hint: 'Cơ quan bơm máu, biểu tượng của yêu thương' },
    { level: 'de', word: 'SÔNG NÚI', hint: 'Cảnh hùng vĩ của giang sơn' },
    { level: 'de', word: 'TÌNH YÊU', hint: 'Cảm xúc đôi lứa say đắm nồng nàn' },
    // ── Trung bình ──
    { level: 'trung_binh', word: 'HOÀNG HÔN', hint: 'Khi vầng dương khuất sau chân trời' },
    { level: 'trung_binh', word: 'BÌNH MINH', hint: 'Tia sáng đầu tiên xé tan màn đêm' },
    { level: 'trung_binh', word: 'TRI KỶ', hint: 'Người hiểu lòng ta như hiểu chính mình' },
    { level: 'trung_binh', word: 'HY VỌNG', hint: 'Ngọn lửa nhỏ giữ lòng người không tắt' },
    { level: 'trung_binh', word: 'KỶ NIỆM', hint: 'Điều đáng nhớ còn mãi trong lòng' },
    { level: 'trung_binh', word: 'UYÊN BÁC', hint: 'Học rộng hiểu sâu như biển cả' },
    { level: 'trung_binh', word: 'KHAI PHÁ', hint: 'Mở lối vào vùng đất hoang sơ' },
    { level: 'trung_binh', word: 'GIANG SƠN', hint: 'Núi sông trải rộng của một nước' },
    { level: 'trung_binh', word: 'CỐ HƯƠNG', hint: 'Nơi ta sinh ra, mãi đau đáu nhớ về' },
    { level: 'trung_binh', word: 'PHONG CẢNH', hint: 'Bức tranh thiên nhiên trải trước mắt' },
    { level: 'trung_binh', word: 'DUYÊN PHẬN', hint: 'Sợi chỉ đỏ định sẵn giữa hai người' },
    { level: 'trung_binh', word: 'THỜI GIAN', hint: 'Dòng chảy lặng lẽ cuốn đi tuổi xuân' },
    { level: 'trung_binh', word: 'CÀN KHÔN', hint: 'Trời đất bao la trong triết lý cổ' },
    { level: 'trung_binh', word: 'HỒNG TRẦN', hint: 'Cõi đời đầy bụi bặm thế gian' },
    { level: 'trung_binh', word: 'PHƯỢNG HOÀNG', hint: 'Chim thần trong truyền thuyết, tái sinh từ lửa' },
    // ── Khó (Tiên hiệp / Nghịch Thủy Hàn) ──
    { level: 'kho', word: 'LINH KHÍ', hint: 'Dòng năng lượng thiên địa để tu luyện' },
    { level: 'kho', word: 'KIM ĐAN', hint: 'Bước ngoặt kết tinh pháp lực khi tu luyện' },
    { level: 'kho', word: 'ĐỘ KIẾP', hint: 'Thử thách sấm sét trước khi phi thăng' },
    { level: 'kho', word: 'PHÁP BẢO', hint: 'Binh khí thần diệu của người tu đạo' },
    { level: 'kho', word: 'KIẾM KHÁCH', hint: 'Hiệp sĩ giang hồ mang binh khí bên mình' },
    { level: 'kho', word: 'GIANG HỒ', hint: 'Chốn võ lâm đầy ân oán tình thù' },
    { level: 'kho', word: 'TÂM MA', hint: 'Chướng ngại trong lòng khi tu luyện' },
    { level: 'kho', word: 'LINH THẠCH', hint: 'Đồng tiền thông dụng của giới tu tiên' },
    { level: 'kho', word: 'ĐẠO HỮU', hint: 'Cách gọi người bạn cùng tu hành' },
    { level: 'kho', word: 'TIÊN NHÂN', hint: 'Bậc siêu phàm sống ngoài vòng trần tục' },
    { level: 'kho', word: 'BẾ QUAN', hint: 'Ẩn mình tĩnh tu, không tiếp khách' },
    { level: 'kho', word: 'PHI THĂNG', hint: 'Rời trần thế bay lên cõi trên' },
    { level: 'kho', word: 'HUYẾT MẠCH', hint: 'Dòng máu truyền thừa trong gia tộc' },
    { level: 'kho', word: 'HIỀN GIẢ', hint: 'Bậc hiểu biết sâu rộng được tôn kính' },
];

module.exports = { WORD_BANK };
