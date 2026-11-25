/**
 * Logic thuần của game "Ai Thông Minh Hơn Thiên Thư Môn" (không phụ thuộc Discord) để dễ kiểm thử.
 * Ngân hàng câu hỏi: ngan_hang_cau_hoi_nghich_thuy_han_200.json ở thư mục gốc dự án.
 */
const fs = require('node:fs');
const path = require('node:path');

const BANK_PATH = path.join(__dirname, '..', '..', '..', 'ngan_hang_cau_hoi_nghich_thuy_han_200.json');
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

const CATEGORY_LABELS = {
    mon_phai_va_loi_choi: '⚔️ Môn phái & lối chơi',
    pvp_pk_va_bang_chien: '🛡️ PK & Bang chiến',
    pve_boss_va_pho_ban: '🐉 Boss & Phó bản',
    giang_ho_va_kham_pha: '🧭 Giang hồ & Khám phá',
    trang_vien_va_doi_song: '🏡 Trang viên & Đời sống',
    trang_bi_va_phat_trien_nhan_vat: '🎽 Trang bị & Phát triển',
    kinh_te_giao_dich_va_su_kien: '💰 Kinh tế, Giao dịch & Sự kiện',
    van_hoa_cong_dong_va_do_vui: '🎭 Văn hoá cộng đồng & Đố vui',
};

const DIFFICULTY_LABELS = {
    easy: { label: '🟢 Dễ', color: '#2ECC71' },
    medium: { label: '🟡 Trung bình', color: '#F1C40F' },
    hard: { label: '🟠 Khó', color: '#E67E22' },
    expert: { label: '🔴 Cao thủ', color: '#E74C3C' },
};

/** Câu hỏi hợp lệ: có nội dung, ≥2 đáp án không rỗng, đáp án đúng nằm trong các lựa chọn. */
function isValidQuestion(q) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) return false;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > LETTERS.length) return false;
    if (!q.options.every((o) => o && typeof o.text === 'string' && o.text.trim() && o.id)) return false;
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length) return false;
    if (new Set(q.options.map((o) => o.text.trim().toLowerCase())).size !== q.options.length) return false;
    return q.options.some((o) => o.id === q.correctAnswer);
}

/** Đọc ngân hàng câu hỏi; bỏ qua (và báo) câu lỗi thay vì làm hỏng cả game. */
function loadBank(file = BANK_PATH) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.questions;
    if (!Array.isArray(list)) throw new Error('Ngân hàng câu hỏi không có mảng "questions"');
    const seen = new Set();
    const questions = [];
    const skipped = [];
    for (const q of list) {
        if (!isValidQuestion(q) || seen.has(q.id)) { skipped.push(q?.id || '(không id)'); continue; }
        seen.add(q.id);
        questions.push(q);
    }
    return { questions, skipped, metadata: raw.metadata || {} };
}

function shuffle(array, rng = Math.random) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Bộ bài câu hỏi: xáo trộn, không lặp câu cho tới khi hết bộ rồi mới xáo lại
 * (và không để câu cuối bộ cũ trùng câu đầu bộ mới).
 */
function createDeck(questions, rng = Math.random) {
    let queue = [];
    let last = null;
    return {
        get size() { return questions.length; },
        next() {
            if (!queue.length) {
                queue = shuffle(questions, rng);
                if (queue.length > 1 && queue[queue.length - 1] === last) queue.unshift(queue.pop());
            }
            last = queue.pop();
            return last;
        },
    };
}

/** Lọc ngân hàng theo độ khó / chủ đề (giá trị 'all' hoặc rỗng = không lọc). */
function filterQuestions(questions, { difficulty, category } = {}) {
    return questions.filter((q) =>
        (!difficulty || difficulty === 'all' || q.difficulty === difficulty) &&
        (!category || category === 'all' || q.category === category));
}

/** Dựng một lượt: xáo thứ tự đáp án và gán lại nhãn A/B/C/D để không thể học vẹt theo vị trí. */
function buildRound(question, rng = Math.random) {
    const shuffled = shuffle(question.options, rng);
    const options = shuffled.map((o, i) => ({
        letter: LETTERS[i],
        text: o.text.trim(),
        correct: o.id === question.correctAnswer,
    }));
    return {
        question,
        options,
        correctLetter: options.find((o) => o.correct).letter,
    };
}

/**
 * Chấm một lượt.
 * @param {Map<string, {letter: string, name: string}>} answers userId -> lựa chọn
 */
function gradeRound(round, answers) {
    const counts = Object.fromEntries(round.options.map((o) => [o.letter, 0]));
    const winners = [];
    for (const [userId, a] of answers) {
        if (a.letter in counts) counts[a.letter]++;
        if (a.letter === round.correctLetter) winners.push({ userId, name: a.name });
    }
    return { counts, winners, answered: answers.size };
}

/** Thanh biểu đồ nhỏ, ví dụ "▰▰▰▱▱" */
function bar(count, total, width = 8) {
    if (!total) return '▱'.repeat(width);
    const filled = Math.max(count > 0 ? 1 : 0, Math.round((count / total) * width));
    return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

module.exports = {
    BANK_PATH, LETTERS, CATEGORY_LABELS, DIFFICULTY_LABELS,
    isValidQuestion, loadBank, shuffle, createDeck, filterQuestions, buildRound, gradeRound, bar,
};
