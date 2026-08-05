const Groq = require('groq-sdk');

let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
}

const SYSTEM_PROMPT = `
Bạn là "Thiên Thư Hiền Giả" - một bậc Đại Năng Tu Tiên vạn năm, chưởng môn của Thiên Thư Môn.
Tính cách & văn phong:
- Luôn xưng "Bản tôn" hoặc "Lão phu", gọi người chơi là "Đạo hữu", "Tiên hữu" hoặc "Đệ tử".
- Lời văn mang đậm phong cách Tiên Hiệp, Cổ Phong, Hán Việt, vừa uy nghiêm vừa hóm hỉnh và uyên bác.
- Thường xuyên dùng các thuật ngữ tu tiên: Linh khí, Tu vi, Tâm ma, Thiên đạo, Khai phá trí tuệ, Ngộ tính, Linh thạch, Hồng trần, Độ kiếp...
- Khi nhận xét game (Nối từ, Vua Tiếng Việt, Bầu Cua, Poker), hãy nhận xét vừa sắc bén vừa giữ đúng thần thái của bậc Hiền Giả Tiên Hiệp.
- Trả lời ngắn gọn, cô đọng, súc tích (khoảng 2-4 câu) phù hợp hiển thị trên Discord Embed.
`;

/**
 * Trả lời tự do bằng giọng văn Thiên Thư Hiền Giả
 */
async function generateSageResponse(userPrompt, extraSystem = '') {
    if (!groq) {
        return 'Bản tôn đang bế quan tu luyện (Chưa cấu hình GROQ_API_KEY trong .env), không thể đáp lời đạo hữu!';
    }

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: SYSTEM_PROMPT + '\n' + extraSystem },
                { role: 'user', content: userPrompt }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            max_tokens: 300,
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
    // Nếu từ trước rỗng => từ đầu tiên
    const prompt = `Kiểm tra từ nối Tiếng Việt:
Từ trước: "${lastWord || 'Không có'}"
Từ hiện tại: "${currentWord}"
Yêu cầu:
1. Từ hiện tại có phải là từ ghép/từ đơn có nghĩa trong tiếng Việt không?
2. Nếu có từ trước, từ hiện tại có bắt đầu bằng tiếng cuối của từ trước không? (Ví dụ: "Tu tiên" -> "Tiên giới" là đúng).
Trả về JSON đúng định dạng: {"valid": true/false, "reason": "Giải thích ngắn giọng Tiên Hiệp", "nextWordSuggestion": "Từ nối gợi ý tiếp theo"}`;

    if (!groq) {
        // Simple fallback
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
                { role: 'system', content: SYSTEM_PROMPT + '\nTrả về CHÍNH XÁC cấu trúc JSON: {"valid": boolean, "reason": string, "nextWordSuggestion": string}. Không kèm markdown codeblock thừa.' },
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
 * Kiểm tra tính hợp lệ từ nối Tiếng Anh
 */
async function validateWordEN(lastWord, currentWord) {
    const prompt = `English Word Chain check:
Last word: "${lastWord || 'None'}"
Current word: "${currentWord}"
Rules: Must be valid English word. If last word exists, current word must start with the LAST LETTER of the last word.
Output JSON format: {"valid": boolean, "meaning": "Dịch nghĩa Hán Việt / Tiên Hiệp", "reason": "Hiền Giả nhận xét (tiếng Việt)", "nextWord": "Gợi ý từ tiếp theo"}`;

    if (!groq) {
        if (lastWord) {
            const lastChar = lastWord.trim().slice(-1).toLowerCase();
            const firstChar = currentWord.trim().slice(0, 1).toLowerCase();
            const valid = lastChar === firstChar;
            return {
                valid,
                meaning: 'Thần Thú / Linh Dược',
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
 * Sinh câu hỏi xáo từ cho Vua Tiếng Việt
 */
async function generateVuaTiengVietQuestion(difficulty = 'trung_binh') {
    const prompt = `Tạo 1 từ hoặc cụm từ Tiếng Việt (có nghĩa, quen thuộc hoặc thuộc chủ đề tu tiên/đời sống).
Độ khó: ${difficulty}.
Trả về JSON:
{
  "originalWord": "Cụm từ gốc (ví dụ: Tu Tiên Giới)",
  "scrambledLetters": "Các chữ cái đã xáo trộn ngẫu nhiên (ví dụ: T u T i ê n G i ớ i -> T i ê n T u G i ớ i)",
  "hint": "Một câu thơ gợi ý mang phong cách Tiên Hiệp bí ẩn"
}`;

    if (!groq) {
        const fallbackList = [
            { originalWord: 'TU TIÊN', scrambledLetters: 'T U T I Ê N', hint: 'Con đường nghịch thiên cải mệnh, hấp thu linh khí thiên địa.' },
            { originalWord: 'HIỀN GIẢ', scrambledLetters: 'H I Ề N G I Ả', hint: 'Bậc đại năng thông tuệ vạn vật, chưởng quản thiên cơ.' },
            { originalWord: 'LINH THẠCH', scrambledLetters: 'L I N H T H Ạ C H', hint: 'Vật phẩm tích tụ linh khí, tiền tệ của giới tu chân.' },
            { originalWord: 'BẦU CUA', scrambledLetters: 'B Ầ U C U A', hint: 'Sáu đại linh thú hội tụ trong quẻ gieo may rủi.' },
            { originalWord: 'TRÚC CƠ', scrambledLetters: 'T R Ú C C Ơ', hint: 'Đắp nền đắp móng cho con đường trường sinh.' }
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
    const prompt = `Kết quả gieo quẻ Bầu Cua Linh Thú:
Kết quả 3 xúc xắc: ${dices.join(', ')}
Tổng tiền cược toàn bàn: ${totalBets} Linh Thạch.
Lợi nhuận người chơi: ${netProfit > 0 ? '+' + netProfit : netProfit} Linh Thạch.
Hãy đưa ra 1 lời bình quẻ tiên hiệp ngắn gọn (2 câu) về vận thế thiên địa, điềm lành/điềm dữ của 3 linh thú xuất hiện.`;

    return await generateSageResponse(prompt);
}

/**
 * Luận giải Poker Hồng Trần
 */
async function generatePokerCommentary(phase, communityCards, winnerName, winHand) {
    const prompt = `Trận Poker Hồng Trần vừa kết thúc!
Vòng: ${phase}
Lá bài chung: ${communityCards.join(' ') || 'Chưa lật'}
Người chiến thắng: ${winnerName}
Loại bài thắng: ${winHand}
Hãy đưa ra lời nhận xét 2 câu phong cách Tiên Hiệp về tâm lý đối thủ, thần thái đánh bài hoặc vận khí thiên đạo.`;

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
