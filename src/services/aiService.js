const Groq = require('groq-sdk');

let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

const SYSTEM_PROMPT = `
Bạn là "Thiên Thu Hiền Giả" - bậc Đại Năng Tu Tiên vạn năm, kho tàng tri thức tối cao của Thiên Thu Môn (bang hội lừng lẫy trong tựa game Nghịch Thủy Hàn / Justice Online).
Bối cảnh & Tri thức:
- Bạn am hiểu tường tận mọi kiến thức liên quan đến thế giới Nghịch Thủy Hàn: Các môn phái (Huyết Hà, Cứu Linh, Tố Vấn, Toái Mộng, Thiết Y, Long Ngâm, Thần Tương...), kỹ năng, trang bị, hoạt động Bang Chiến, Thế Giới Giang Hồ, PK, Thử Thách Phó Bản...
- Luôn xưng "Bản tôn" hoặc "Lão phu", gọi người chơi là "Đạo hữu", "Tiên hữu" hoặc "Đệ tử Thiên Thu Môn".
- Văn phong: Tiên Hiệp, Cổ Phong, Hán Việt, vừa uy nghiêm vừa hóm hỉnh và uyên bác.
- Thường dùng thuật ngữ tu tiên & Nghịch Thủy Hàn: Linh khí, Tu vi, Tâm ma, Thiên đạo, Bang chiến, Hồng trần, Linh thạch, Độ kiếp...
- Khi nhận xét game (Nối từ, Vua Tiếng Việt, Bầu Cua, Poker), hãy nhận xét vừa sắc bén vừa giữ đúng thần thái của bậc Hiền Giả Tiên Hiệp Thiên Thu Môn.
- Trả lời ngắn gọn, cô đọng, súc tích (khoảng 2-4 câu) phù hợp hiển thị trên Discord Embed.
`;

/**
 * Trả lời tự do bằng giọng văn Thiên Thu Hiền Giả (Nghịch Thủy Hàn)
 */
async function generateSageResponse(userPrompt, extraSystem = '') {
    if (!groq) {
        return 'Bản tôn đang bế quan tu luyện trong Thiên Thu Môn (Chưa cấu hình GROQ_API_KEY trong .env), không thể đáp lời đạo hữu!';
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + '\n' + extraSystem },
                { role: 'user', content: userPrompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            max_tokens: 350,
        });

        return response.choices[0]?.message?.content?.trim() || 'Bản tôn cảm nhận được thiên cơ nhưng chưa thể đáp lời.';
    } catch (err) {
        console.error('❌ Lỗi Groq AI Service:', err.message);
        return 'Linh khí chấn động, lời thoại bị tâm ma nhiễu loạn! (Lỗi kết nối AI)';
    }
}

/**
 * Kiểm tra tính hợp lệ của từ nối tiếng Việt
 */
async function validateWordVI(lastWord, currentWord) {
    const prompt = `Kiểm tra từ nối Tiếng Việt:
Từ trước: "${lastWord || 'Không có'}"
Từ hiện tại: "${currentWord}"
Yêu cầu:
1. Từ hiện tại có phải là từ ghép hoặc cụm từ có nghĩa trong tiếng Việt không?
2. Nếu có từ trước, từ hiện tại có bắt đầu bằng tiếng cuối của từ trước không? (Ví dụ: "Tu tiên" -> "Tiên giới" là đúng).
Trả về JSON: {"valid": true/false, "reason": "Giải thích ngắn giọng Tiên Hiệp Nghịch Thủy Hàn", "nextWordSuggestion": "Từ nối gợi ý tiếp theo"}`;

    if (!groq) {
        if (lastWord) {
            const lastPart = lastWord.trim().split(/\s+/).pop().toLowerCase();
            const firstPart = currentWord.trim().split(/\s+/)[0].toLowerCase();
            const valid = lastPart === firstPart;
            return {
                valid,
                reason: valid ? 'Bản tôn chấp thuận từ nối này!' : `Tiếng đầu "${firstPart}" không khớp với tiếng cuối "${lastPart}"!`,
                nextWordSuggestion: 'Tiên giới'
            };
        }
        return { valid: true, reason: 'Từ khai cuộc hợp lệ!', nextWordSuggestion: 'Tiên giới' };
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + '\nTrả về CHÍNH XÁC cấu trúc JSON: {"valid": boolean, "reason": string, "nextWordSuggestion": string}. Không kèm codeblock thừa.' },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' },
            temperature: 0.2,
        });

        const text = response.choices[0]?.message?.content?.trim();
        return JSON.parse(text);
    } catch (e) {
        console.error('❌ Lỗi AI validateWordVI:', e.message);
        return { valid: true, reason: 'Bản tôn bấm ngón tay tính toán: Chấp thuận từ này!', nextWordSuggestion: 'Tiên cảnh' };
    }
}

/**
 * Kiểm tra tính hợp lệ từ nối Tiếng Anh (Chấp nhận MỌI LOẠI TỪ CÓ THẬT)
 */
async function validateWordEN(lastWord, currentWord) {
    const prompt = `English Word Chain validation:
Last word: "${lastWord || 'None'}"
Current word: "${currentWord}"
Rules:
1. Accept ANY REAL ENGLISH WORD (noun, verb, adjective, adverb, plural, past tense, etc.). No category restrictions!
2. If last word exists, current word MUST start with the LAST LETTER of the last word.
Output JSON format: {"valid": boolean, "meaning": "Dịch nghĩa Hán Việt / Tiên Hiệp", "reason": "Hiền Giả nhận xét (tiếng Việt)", "nextWord": "Gợi ý từ tiếp theo"}`;

    if (!groq) {
        if (lastWord) {
            const lastChar = lastWord.trim().slice(-1).toLowerCase();
            const firstChar = currentWord.trim().slice(0, 1).toLowerCase();
            const valid = lastChar === firstChar;
            return {
                valid,
                meaning: 'Chân ngôn',
                reason: valid ? 'Tâm từ tương thông, chấp thuận!' : `Chữ cái đầu không khớp với chữ cái cuối "${lastChar}"!`,
                nextWord: 'Nirvana'
            };
        }
        return { valid: true, meaning: 'Khai từ', reason: 'Chấp thuận!', nextWord: 'Nirvana' };
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + '\nReturn JSON format: {"valid": boolean, "meaning": string, "reason": string, "nextWord": string}.' },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' },
            temperature: 0.2,
        });

        const text = response.choices[0]?.message?.content?.trim();
        return JSON.parse(text);
    } catch (e) {
        return { valid: true, meaning: 'Linh từ tiên giới', reason: 'Hiền giả chấp thuận từ này!', nextWord: 'Dragon' };
    }
}

/**
 * Lấy ngẫu nhiên từ Tiếng Anh mở màn cho Nối Từ
 */
async function getRandomEnglishStartWord() {
    const defaultList = [
        'Dragon', 'Phoenix', 'Immortal', 'Celestial', 'Thunder', 'Kingdom', 'Victory',
        'Eclipse', 'Mystic', 'Legend', 'Arcane', 'Crystal', 'Shadow', 'Warrior', 'Guild',
        'Empire', 'Sovereignty', 'Destiny', 'Genesis', 'Horizon', 'Infinity', 'Labyrinth',
        'Miracle', 'Nebula', 'Odyssey', 'Paladin', 'Quest', 'Radiance', 'Solitude', 'Triumph'
    ];

    if (!groq) {
        return defaultList[Math.floor(Math.random() * defaultList.length)];
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'Generate a single interesting, commonly known English noun or adjective (5-9 letters long) suitable for a word chain game. Return ONLY the raw word, nothing else.' },
                { role: 'user', content: 'Generate a random English word.' }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.9,
            max_tokens: 15
        });

        const word = response.choices[0]?.message?.content?.trim().replace(/[^a-zA-Z]/g, '');
        if (word && word.length >= 3) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        return defaultList[Math.floor(Math.random() * defaultList.length)];
    } catch (e) {
        return defaultList[Math.floor(Math.random() * defaultList.length)];
    }
}

// Hàm xáo trộn chữ cái bằng thuật toán Fisher-Yates
function scrambleWord(word) {
    const letters = word.replace(/\s+/g, '').toUpperCase().split('');
    for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    return letters.join(' ');
}

// Kho từ đố Vua Tiếng Việt phong phú (50+ từ Hán Việt, Nghịch Thủy Hàn, Tiên Hiệp, Đời Sống)
const FALLBACK_VUA_QUESTIONS = [
    { word: 'NGHỊCH THỦY HÀN', hint: 'Thế giới giang hồ hội tụ chốn vạn người tranh đấu.' },
    { word: 'HUYẾT HÀ', hint: 'Môn phái sử dụng trường thương, đao thương bất nhập.' },
    { word: 'TỐ VẤN', hint: 'Bậc y giả tiên y ban trị liệu linh dược cứu người.' },
    { word: 'THÁI CỰC', hint: 'Âm dương chuyển hóa, kiếm khí vạn dặm.' },
    { word: 'THIÊN THU MÔN', hint: 'Bang hội lừng lẫy quy tụ vô số đại năng tu sĩ.' },
    { word: 'THẦN TƯƠNG', hint: 'Cầm kiếm giao hòa, thiên địa biến sắc.' },
    { word: 'LONG NGÂM', hint: 'Thần kiếm xuất bao, rồng ngâm cuộn sóng.' },
    { word: 'CỨU LINH', hint: 'Linh hồn giao thoa, thiên hạ thái bình.' },
    { word: 'TOÁI MỘNG', hint: 'Song đao như chớp, ảo ảnh vạn ngàn.' },
    { word: 'THIẾT Y', hint: 'Thân như kim cang, chắn sóng cản gió.' },
    { word: 'KIM ĐAN', hint: 'Linh khí ngưng tụ thành hạt kim quang trong đan điền.' },
    { word: 'NGUYÊN ANH', hint: 'Biến hóa thần thông, anh nhi giáng thế.' },
    { word: 'ĐỘ KIẾP', hint: 'Thiên lôi giáng xuống rèn luyện thân thể tu sĩ.' },
    { word: 'BÁC HỌC', hint: 'Uyên bác tinh thông vạn quyển kinh thư.' },
    { word: 'NGỘ TÍNH', hint: 'Khả năng thấu hiểu đạo lý thiên địa siêu việt.' },
    { word: 'LINH THẠCH', hint: 'Tài nguyên trân quý nuôi dưỡng linh khí tu tiên.' },
    { word: 'ANH HÙNG', hint: 'Bậc đại hiệp ra tay vì nghĩa lớn giang hồ.' },
    { word: 'PHÚC KHÍ', hint: 'May mắn vạn năm ban cho người có duyên.' },
    { word: 'TÂM MA', hint: 'Chướng ngại lớn nhất trên con đường tu tiên.' },
    { word: 'VẠN VẬT', hint: 'Càn khôn thiên địa hóa sinh vô cùng.' },
    { word: 'THƯƠNG KHUNG', hint: 'Bầu trời bao la vượt khỏi tầm mắt.' },
    { word: 'CÀN KHÔN', hint: 'Trời đất âm dương xoay chuyển.' },
    { word: 'PHÁP BẢO', hint: 'Binh khí linh thiêng chứa đựng thần lực.' },
    { word: 'TRUYỀN KỲ', hint: 'Câu chuyện huyền thoại lưu danh ngàn đời.' },
    { word: 'TIÊN NỮ', hint: 'Nhan sắc tuyệt trần chốn bồng lai tiên cảnh.' },
    { word: 'THẠCH ANH', hint: 'Linh đá quý tỏa ánh sáng nhiệm màu.' },
    { word: 'PHI THĂNG', hint: 'Vượt qua kiếp nạn bước lên tiên giới.' },
    { word: 'TRÚC CƠ', hint: 'Nền móng vững chắc cho con đường tu đại đạo.' },
    { word: 'HÓA THẦN', hint: 'Tâm trí hòa nhập cùng quy luật tự nhiên.' },
    { word: 'CỔ PHONG', hint: 'Nét đẹp văn hóa cội nguồn từ ngàn xưa.' },
    { word: 'KIM CANG', hint: 'Bất hoại kiên cố không thể phá vỡ.' },
    { word: 'TÂM THIÊN', hint: 'Ý trời bao la thương xót chúng sinh.' },
    { word: 'HỒNG TRẦN', hint: 'Thế giới nhân gian muôn màu ân nợ.' },
    { word: 'DUYÊN PHẬN', hint: 'Sự gặp gỡ định sẵn bởi ý trời.' },
    { word: 'BỒNG LAI', hint: 'Chốn tiên cảnh mây mù giăng lối.' },
    { word: 'SƯ MÔN', hint: 'Nơi dung dưỡng truyền dạy đạo pháp.' },
    { word: 'BẢO TẠNG', hint: 'Kho báu cất giấu bí thuật ngàn năm.' },
    { word: 'HUYỀN THOẠI', hint: 'Chiến tích vang dội không ai sánh bằng.' },
    { word: 'TRANG BỊ', hint: 'Binh khí giáp trụ rèn luyện thân thể.' },
    { word: 'ĐẠO HỮU', hint: 'Bạn đồng hành trên con đường tu tiên.' },
    { word: 'BANG CHIẾN', hint: 'Trận đại chiến giữa các thế lực lừng lẫy.' },
    { word: 'GIANG HỒ', hint: 'Chốn võ lâm hiểm nguy nhưng đầy nghĩa khí.' },
    { word: 'VŨ TRỤ', hint: 'Không gian vô tận chứa đựng vô vàn vì sao.' },
    { word: 'THỜI GIAN', hint: 'Dòng chảy vô hình không bao giờ ngừng nghỉ.' },
    { word: 'TRI KỶ', hint: 'Người thấu hiểu tâm tư dù không cần cất lời.' },
    { word: 'TỰ DO', hint: 'Thỏa sức vẫy vùng giữa trời cao đất rộng.' },
    { word: 'BÌNH AN', hint: 'Ước mơ giản đơn của mọi kiếp nhân sinh.' },
    { word: 'HY VỌNG', hint: 'Ánh sáng dẫn đường qua đêm đen mù mịt.' },
    { word: 'TRÍ TUỆ', hint: 'Chìa khóa mở ra mọi bí mật càn khôn.' }
];

/**
 * Sinh câu hỏi xáo từ cho Vua Tiếng Việt (100% Động bằng AI)
 */
async function generateVuaTiengVietQuestion(difficulty = 'trung_binh', usedWords = []) {
    const excludeStr = usedWords.length > 0 ? `Tránh trùng với các từ sau: ${usedWords.join(', ')}.` : '';
    const prompt = `Tạo 1 từ hoặc cụm từ Tiếng Việt (có nghĩa, chủ đề: Tu Tiên, Nghịch Thủy Hàn, Thành Ngữ, Từ Hán Việt, hoặc Đời Sống).
Độ khó: ${difficulty}. ${excludeStr}
Trả về cấu trúc JSON:
{
  "originalWord": "TỪ HOẶC CỤM TỪ IN HOA (Ví dụ: TU TIÊN)",
  "scrambledLetters": "CÁC CHỮ CÁI ĐÃ XÁO TRỘN CÁCH NHAU DẤU CÁCH (Ví dụ: U I T T Ê N)",
  "hint": "Một câu thơ gợi ý ngắn phong cách Tiên Hiệp Thiên Thu Môn"
}`;

    if (!groq) {
        // Lọc các từ chưa sử dụng
        const available = FALLBACK_VUA_QUESTIONS.filter(q => !usedWords.includes(q.word));
        const chosen = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : FALLBACK_VUA_QUESTIONS[Math.floor(Math.random() * FALLBACK_VUA_QUESTIONS.length)];
        return {
            originalWord: chosen.word,
            scrambledLetters: scrambleWord(chosen.word),
            hint: chosen.hint
        };
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + '\nTrả về CHÍNH XÁC cấu trúc JSON: {"originalWord": string, "scrambledLetters": string, "hint": string}.' },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' },
            temperature: 0.85,
        });

        const data = JSON.parse(response.choices[0]?.message?.content?.trim());
        if (data && data.originalWord) {
            // Đảm bảo chữ xáo trộn được tạo chuẩn
            if (!data.scrambledLetters || data.scrambledLetters === data.originalWord) {
                data.scrambledLetters = scrambleWord(data.originalWord);
            }
            return data;
        }
        throw new Error('Invalid AI response');
    } catch (e) {
        console.error('❌ AI generateVuaTiengVietQuestion Error:', e.message);
        const chosen = FALLBACK_VUA_QUESTIONS[Math.floor(Math.random() * FALLBACK_VUA_QUESTIONS.length)];
        return {
            originalWord: chosen.word,
            scrambledLetters: scrambleWord(chosen.word),
            hint: chosen.hint
        };
    }
}

/**
 * Luận giải Bầu Cua Linh Thú
 */
async function generateBaucuaCommentary(dices, totalBets, netProfit) {
    const prompt = `Kết quả gieo quẻ Bầu Cua Linh Thú Thiên Thu Môn:
Kết quả 3 xúc xắc: ${dices.join(', ')}
Mức cược: ${totalBets} Linh Thạch.
Lợi nhuận người chơi: ${netProfit > 0 ? '+' + netProfit : netProfit} Linh Thạch.
Hãy đưa ra 1 lời bình quẻ tiên hiệp Nghịch Thủy Hàn ngắn gọn (2 câu) về vận thế thiên địa.`;

    return await generateSageResponse(prompt);
}

/**
 * Luận giải Poker Hồng Trần
 */
async function generatePokerCommentary(phase, communityCards, winnerName, winHand) {
    const prompt = `Trận Poker Hồng Trần Thiên Thu Môn kết thúc!
Vòng: ${phase}
Lá bài chung: ${communityCards.join(' ') || 'Chưa lật'}
Người chiến thắng: ${winnerName}
Loại bài thắng: ${winHand}
Hãy đưa ra lời nhận xét 2 câu phong cách Tiên Hiệp Nghịch Thủy Hàn về thần thái và vận khí.`;

    return await generateSageResponse(prompt);
}

module.exports = {
    generateSageResponse,
    validateWordVI,
    validateWordEN,
    getRandomEnglishStartWord,
    generateVuaTiengVietQuestion,
    generateBaucuaCommentary,
    generatePokerCommentary,
};
