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
 * Sinh câu hỏi xáo từ cho Vua Tiếng Việt (bao gồm cả thuật ngữ Nghịch Thủy Hàn)
 */
async function generateVuaTiengVietQuestion(difficulty = 'trung_binh') {
    const prompt = `Tạo 1 từ hoặc cụm từ Tiếng Việt (từ có nghĩa hoặc các thuật ngữ Nghịch Thủy Hàn / Tu Tiên / Đời sống).
Độ khó: ${difficulty}.
Trả về JSON:
{
  "originalWord": "Cụm từ gốc (ví dụ: NGHỊCH THỦY HÀN, HUYẾT HÀ, TỐ VẤN, TU TIÊN...)",
  "scrambledLetters": "Các chữ cái đã xáo trộn ngẫu nhiên",
  "hint": "Một câu thơ gợi ý phong cách Tiên Hiệp Thiên Thu Môn"
}`;

    if (!groq) {
        const fallbackList = [
            { originalWord: 'NGHỊCH THỦY HÀN', scrambledLetters: 'N G H Ị C H T H U Ỷ H À N', hint: 'Thế giới giang hồ hội tụ chốn vạn người tranh đấu.' },
            { originalWord: 'HUYẾT HÀ', scrambledLetters: 'H U Y Ế T H À', hint: 'Môn phái sử dụng trường thương, đao thương bất nhập.' },
            { originalWord: 'TỐ VẤN', scrambledLetters: 'T Ố V Ấ N', hint: 'Bậc y giả tiên y ban trị liệu linh dược cứu người.' },
            { originalWord: 'THÁI CỰC', scrambledLetters: 'T H Á I C Ự C', hint: 'Âm dương chuyển hóa, kiếm khí vạn dặm.' },
            { originalWord: 'THIÊN THU MÔN', scrambledLetters: 'T H I Ê N T H U M Ô N', hint: 'Bang hội lừng lẫy quy tụ vô số đại năng tu sĩ.' }
        ];
        return fallbackList[Math.floor(Math.random() * fallbackList.length)];
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + '\nTrả về CHÍNH XÁC JSON: {"originalWord": string, "scrambledLetters": string, "hint": string}.' },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
            response_format: { type: 'json_object' },
            temperature: 0.8,
        });

        return JSON.parse(response.choices[0]?.message?.content?.trim());
    } catch (e) {
        return { originalWord: 'TU TIÊN', scrambledLetters: 'T U T I Ê N', hint: 'Con đường nghịch thiên cải mệnh.' };
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
    generateVuaTiengVietQuestion,
    generateBaucuaCommentary,
    generatePokerCommentary,
};
