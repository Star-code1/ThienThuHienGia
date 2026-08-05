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
 * Hệ thống gọi AI đa nhà cung cấp với cơ chế tự động chuyển vùng khi hết Token/Lỗi:
 * 1. Gemini 2.5 Flash (GEMINI_API_KEY)
 * 2. Groq (GROQ_API_KEY)
 * 3. DeepSeek V3 (DEEPSEEK_API_KEY)
 * 4. OpenRouter (OPENROUTER_API_KEY)
 */
async function callMultiProviderAI({ systemPrompt = '', userPrompt, jsonMode = false }) {
    const providers = [
        {
            name: 'Gemini 2.5 Flash',
            key: process.env.GEMINI_API_KEY,
            call: async (key) => {
                // Thử gemini-2.5-flash, nếu API chưa mở thử gemini-2.0-flash / gemini-1.5-flash
                const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
                let lastErr = null;

                for (const modelName of models) {
                    try {
                        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
                        const body = {
                            contents: [
                                {
                                    role: 'user',
                                    parts: [{ text: (systemPrompt ? systemPrompt + '\n\n' : '') + userPrompt }]
                                }
                            ],
                            generationConfig: {
                                temperature: 0.75,
                                maxOutputTokens: 1000,
                                ...(jsonMode ? { responseMimeType: 'application/json' } : {})
                            }
                        };
                        const res = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });

                        if (!res.ok) {
                            const textErr = await res.text();
                            throw new Error(`Status ${res.status}: ${textErr}`);
                        }

                        const data = await res.json();
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text && text.trim()) return text.trim();
                    } catch (e) {
                        lastErr = e;
                    }
                }
                throw lastErr || new Error('Gemini API call failed');
            }
        },
        {
            name: 'Groq',
            key: process.env.GROQ_API_KEY,
            call: async (key) => {
                const url = 'https://api.groq.com/openai/v1/chat/completions';
                const body = {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.75,
                    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                if (!res.ok) {
                    const textErr = await res.text();
                    throw new Error(`Groq Error (${res.status}): ${textErr}`);
                }
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content;
                if (!text) throw new Error('Groq returned empty response');
                return text.trim();
            }
        },
        {
            name: 'DeepSeek V3',
            key: process.env.DEEPSEEK_API_KEY,
            call: async (key) => {
                const url = 'https://api.deepseek.com/chat/completions';
                const body = {
                    model: 'deepseek-chat',
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                });
                if (!res.ok) {
                    const textErr = await res.text();
                    throw new Error(`DeepSeek Error (${res.status}): ${textErr}`);
                }
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content;
                if (!text) throw new Error('DeepSeek returned empty response');
                return text.trim();
            }
        },
        {
            name: 'OpenRouter',
            key: process.env.OPENROUTER_API_KEY,
            call: async (key) => {
                const url = 'https://openrouter.ai/api/v1/chat/completions';
                const body = {
                    model: 'deepseek/deepseek-chat',
                    messages: [
                        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.7,
                    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
                };
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://discordbot.org',
                        'X-Title': 'ThienThuHienGia_DiscordBot'
                    },
                    body: JSON.stringify(body)
                });
                if (!res.ok) {
                    const textErr = await res.text();
                    throw new Error(`OpenRouter Error (${res.status}): ${textErr}`);
                }
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content;
                if (!text) throw new Error('OpenRouter returned empty response');
                return text.trim();
            }
        }
    ];

    for (const provider of providers) {
        if (!provider.key) continue;

        try {
            const result = await provider.call(provider.key);
            console.log(`🤖 AI Response from [${provider.name}] successful!`);
            return result;
        } catch (err) {
            console.warn(`⚠️ [${provider.name}] gặp lỗi/hết token: ${err.message}. Đang tự động chuyển sang Provider AI tiếp theo...`);
        }
    }

    throw new Error('Tất cả các AI Provider (Gemini 2.5 Flash, Groq, DeepSeek V3, OpenRouter) đều chưa cấu hình key hoặc đã hết Token.');
}

/**
 * Trả lời tự do bằng giọng văn Thiên Thu Hiền Giả
 */
async function generateSageResponse(userPrompt, extraSystem = '') {
    try {
        const result = await callMultiProviderAI({
            systemPrompt: SYSTEM_PROMPT + '\n' + extraSystem,
            userPrompt
        });
        return result;
    } catch (err) {
        console.error('❌ Lỗi AI MultiProvider:', err.message);
        return 'Bản tôn đang bế quan tu luyện trong Thiên Thu Môn (Chưa cấu hình API Key hoặc các AI đã hết token), chưa thể đáp lời đạo hữu!';
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

    try {
        const rawJson = await callMultiProviderAI({
            systemPrompt: SYSTEM_PROMPT + '\nTrả về CHÍNH XÁC cấu trúc JSON: {"valid": boolean, "reason": string, "nextWordSuggestion": string}. Không kèm codeblock thừa.',
            userPrompt: prompt,
            jsonMode: true
        });
        return JSON.parse(rawJson);
    } catch (e) {
        console.error('❌ Lỗi AI validateWordVI:', e.message);
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
}

/**
 * Kiểm tra tính hợp lệ từ nối Tiếng Anh
 */
async function validateWordEN(lastWord, currentWord) {
    const prompt = `English Word Chain validation:
Last word: "${lastWord || 'None'}"
Current word: "${currentWord}"
Rules:
1. Accept ANY REAL ENGLISH WORD (noun, verb, adjective, adverb, plural, past tense, etc.). No category restrictions!
2. If last word exists, current word MUST start with the LAST LETTER of the last word.
Output JSON format: {"valid": boolean, "meaning": "Dịch nghĩa Hán Việt / Tiên Hiệp", "reason": "Hiền Giả nhận xét (tiếng Việt)", "nextWord": "Gợi ý từ tiếp theo"}`;

    try {
        const rawJson = await callMultiProviderAI({
            systemPrompt: SYSTEM_PROMPT + '\nReturn JSON format: {"valid": boolean, "meaning": string, "reason": string, "nextWord": string}.',
            userPrompt: prompt,
            jsonMode: true
        });
        return JSON.parse(rawJson);
    } catch (e) {
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
        return { valid: true, meaning: 'Linh từ tiên giới', reason: 'Hiền giả chấp thuận từ này!', nextWord: 'Nirvana' };
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

    try {
        const rawText = await callMultiProviderAI({
            systemPrompt: 'Generate a single interesting, commonly known English noun or adjective (5-9 letters long) suitable for a word chain game. Return ONLY the raw word, nothing else.',
            userPrompt: 'Generate a random English word.'
        });
        const word = rawText.replace(/[^a-zA-Z]/g, '');
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

// Kho từ đố Vua Tiếng Việt phong phú (50+ từ)
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
 * Sinh câu hỏi xáo từ cho Vua Tiếng Việt (100% Động bằng AI Đa Nhà Cung Cấp)
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

    try {
        const rawJson = await callMultiProviderAI({
            systemPrompt: SYSTEM_PROMPT + '\nTrả về CHÍNH XÁC cấu trúc JSON: {"originalWord": string, "scrambledLetters": string, "hint": string}.',
            userPrompt: prompt,
            jsonMode: true
        });

        const data = JSON.parse(rawJson);
        if (data && data.originalWord) {
            if (!data.scrambledLetters || data.scrambledLetters === data.originalWord) {
                data.scrambledLetters = scrambleWord(data.originalWord);
            }
            return data;
        }
        throw new Error('Invalid AI response schema');
    } catch (e) {
        console.error('❌ AI generateVuaTiengVietQuestion Error:', e.message);
        const available = FALLBACK_VUA_QUESTIONS.filter(q => !usedWords.includes(q.word));
        const chosen = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : FALLBACK_VUA_QUESTIONS[Math.floor(Math.random() * FALLBACK_VUA_QUESTIONS.length)];
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
