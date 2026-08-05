const SYSTEM_PROMPT = `
Bạn là "Thiên Thư Hiền Giả" - bậc Đại Năng Tu Tiên vạn năm, kho tàng tri thức tối cao của Thiên Thư Môn (bang hội lừng lẫy trong tựa game Nghịch Thủy Hàn / Justice Online).
Bối cảnh & Tri thức:
- Bạn am hiểu tường tận mọi kiến thức liên quan đến thế giới Nghịch Thủy Hàn: Các môn phái (Huyết Hà, Cứu Linh, Tố Vấn, Toái Mộng, Thiết Y, Long Ngâm, Thần Tương...), kỹ năng, trang bị, hoạt động Bang Chiến, Thế Giới Giang Hồ, PK, Thử Thách Phó Bản...
- Luôn xưng "Bổn Hiền Giả" hoặc "Lão phu", gọi người chơi là "Đạo hữu", "Tiên hữu" hoặc "Đệ tử Thiên Thư Môn".
- Văn phong: Tiên Hiệp, Cổ Phong, Hán Việt, vừa uy nghiêm vừa hóm hỉnh và uyên bác.
- Thường dùng thuật ngữ tu tiên & Nghịch Thủy Hàn: Linh khí, Tu vi, Tâm ma, Thiên đạo, Bang chiến, Hồng trần, Linh thạch, Độ kiếp...
- Trả lời ngắn gọn, cô đọng, súc tích (dưới 3 câu) phù hợp hiển thị trên Discord Embed.
`;

/**
 * Hệ thống gọi AI đa nhà cung cấp với cơ chế tự động chuyển vùng khi hết Token/Lỗi & Tối ưu tốc độ (Fast Speed):
 * 1. Gemini 2.5 Flash (GEMINI_API_KEY)
 * 2. Groq (GROQ_API_KEY)
 * 3. DeepSeek V3 (DEEPSEEK_API_KEY)
 * 4. OpenRouter (OPENROUTER_API_KEY)
 */
async function callMultiProviderAI({ systemPrompt = '', userPrompt, jsonMode = false, maxTokens = 250 }) {
    const providers = [
        {
            name: 'Gemini 2.5 Flash',
            key: process.env.GEMINI_API_KEY,
            call: async (key) => {
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
                                temperature: 0.3,
                                maxOutputTokens: maxTokens,
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
                    temperature: 0.3,
                    max_tokens: maxTokens,
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
                    temperature: 0.3,
                    max_tokens: maxTokens,
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
                    temperature: 0.3,
                    max_tokens: maxTokens,
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
            return result;
        } catch (err) {
            console.warn(`⚠️ [${provider.name}] gặp lỗi/hết token: ${err.message}. Đang chuyển AI tiếp theo...`);
        }
    }

    throw new Error('Tất cả AI Providers đều chưa cấu hình key hoặc hết Token.');
}

/**
 * Trả lời tự do bằng giọng văn Thiên Thư Hiền Giả
 */
async function generateSageResponse(userPrompt, extraSystem = '') {
    try {
        const result = await callMultiProviderAI({
            systemPrompt: SYSTEM_PROMPT + '\n' + extraSystem,
            userPrompt,
            maxTokens: 300
        });
        return result;
    } catch (err) {
        console.error('❌ Lỗi AI MultiProvider:', err.message);
        return 'Bản tôn đang bế quan tu luyện trong Thiên Thư Môn (Chưa cấu hình API Key hoặc các AI đã hết token), chưa thể đáp lời đạo hữu!';
    }
}

/**
 * Kiểm tra tính hợp lệ của từ nối tiếng Việt (Prompt Tiên Trưởng Lão Khó Tính + Pre-check 0ms)
 */
async function validateWordVI(lastWord, currentWord) {
    const cleanLast = (lastWord || '').trim();
    const cleanCurr = (currentWord || '').trim();

    // ⚡ PRE-CHECK SIÊU TỐC (0ms Latency): Nếu không khớp âm tiết nối -> Từ chối ngay lập tức không cần chờ AI!
    if (cleanLast) {
        const lastPart = cleanLast.split(/\s+/).pop().toLowerCase();
        const firstPart = cleanCurr.split(/\s+/)[0].toLowerCase();
        if (lastPart !== firstPart) {
            return {
                valid: false,
                reason: `Âm tiết đầu "${firstPart.toUpperCase()}" của ngươi không khớp với âm tiết cuối "${lastPart.toUpperCase()}" của từ trước! Quy tắc cơ bản cũng không thuộc sao?`,
                nextWord: ''
            };
        }
    }

    const prompt = `Bạn là một vị Tiên trưởng lão khó tính, phụ trách kiểm duyệt trò chơi "Nối từ Tiếng Việt". Nhiệm vụ: xác định từ hiện tại có hợp lệ và nối đúng với từ trước hay không.

DỮ LIỆU ĐẦU VÀO:
- Từ trước (lastWord): "${cleanLast || 'Không có'}"
- Từ hiện tại (currentWord): "${cleanCurr}"

QUY TẮC BẮT BUỘC (phải thoả mãn đồng thời):
1. Tính hợp lệ của từ:
   - currentWord phải là một từ ghép hoặc cụm từ có nghĩa xác thực, được ghi nhận trong tiếng Việt hiện đại (có thể tra từ điển).
   - Không chấp nhận: từ viết tắt (VD: "THPT"), tên riêng (trừ khi đã thành danh từ chung), tiếng lóng không chính thống, hoặc âm tiết rời rạc vô nghĩa.

2. Luật nối âm tiết (chỉ áp dụng nếu lastWord tồn tại):
   - Tách lastWord và currentWord thành các âm tiết.
   - Âm tiết cuối cùng của lastWord PHẢI trùng khớp HOÀN TOÀN (cả chữ và dấu) với âm tiết đầu tiên của currentWord.
   - Ví dụ ĐÚNG: "Tu tiên" → "Tiên giới" (nối "tiên").
   - Ví dụ SAI: "Công pháp" → "Phép màu" (SAI, vì âm cuối "pháp" khác âm đầu "phép" – khác dấu).
   - Trường hợp đặc biệt: Nếu từ chỉ có 1 âm tiết (VD: "Nhà"), từ tiếp theo phải bắt đầu bằng chính âm tiết đó (VD: "Nhà cửa" là ĐÚNG).

PHONG CÁCH PHẢN HỒI:
- Giọng điệu của một tiền bối cổ xưa, hài hước, có phần mỉa mai, mang chất triết lý "Nghịch Thủy Hàn".
- Đưa ra nhận xét ngắn gọn (dưới 30 từ) về lý do đúng/sai, chỉ rõ lỗi nếu có.

ĐỊNH DẠNG ĐẦU RA (JSON):
Chỉ trả về một đối tượng JSON hợp lệ:
{
  "valid": boolean,
  "reason": "string",
  "nextWord": "string"
}`;

    try {
        const rawJson = await callMultiProviderAI({
            systemPrompt: 'Trả về CHÍNH XÁC cấu trúc JSON: {"valid": boolean, "reason": string, "nextWord": string}. Không kèm codeblock thừa.',
            userPrompt: prompt,
            jsonMode: true,
            maxTokens: 150
        });
        return JSON.parse(rawJson);
    } catch (e) {
        console.error('❌ Lỗi AI validateWordVI:', e.message);
        return {
            valid: true,
            reason: 'Bổn trưởng lão du ngoạn qua, tạm chấp thuận từ nối này!',
            nextWord: ''
        };
    }
}

/**
 * Kiểm tra tính hợp lệ từ nối Tiếng Anh (Prompt Strict Ancient Librarian + Pre-check 0ms)
 */
async function validateWordEN(lastWord, currentWord) {
    const cleanLast = (lastWord || '').trim();
    const cleanCurr = (currentWord || '').trim();

    // ⚡ PRE-CHECK SIÊU TỐC (0ms Latency): Nếu chữ cái đầu không khớp chữ cái cuối -> Từ chối ngay!
    if (cleanLast) {
        const lastChar = cleanLast.slice(-1).toLowerCase();
        const firstChar = cleanCurr.slice(0, 1).toLowerCase();
        if (lastChar !== firstChar) {
            return {
                valid: false,
                reason: `The first letter '${firstChar.toUpperCase()}' does not match the last letter '${lastChar.toUpperCase()}' of "${cleanLast}"! Learn basic spelling, novice.`,
                nextWord: '',
                meaning: 'Mismatch'
            };
        }
    }

    const prompt = `You are a strict, ancient librarian and word-game referee. Your task: verify whether the current word is a valid English word and, if there is a previous word, whether it correctly continues the chain by its last letter.

INPUT DATA:
- Previous word (lastWord): "${cleanLast || 'None'}"
- Current word (currentWord): "${cleanCurr}"

MANDATORY RULES (must satisfy ALL):
1. Lexical validity:
   - currentWord must be a real English word (noun, verb, adjective, adverb, plural, past tense, etc.). Accept any form listed in standard dictionaries.
   - Do NOT accept: abbreviations (e.g., "LOL"), proper nouns (unless commonly used as common nouns, e.g., "sandwich"), made-up words, or non-standard slang.

2. Letter‑chaining rule (only applies if lastWord is not empty):
   - The LAST letter of lastWord (ignoring case) MUST be exactly the FIRST letter of currentWord (ignoring case).
   - Example CORRECT: "apple" → "elephant" (last letter 'e' = first letter 'e').
   - Example WRONG: "dog" → "cat" (last letter 'g' ≠ first letter 'c').
   - For words with apostrophes or hyphens, use the last alphabetic character (e.g., "don't" → last letter 't').

RESPONSE STYLE:
- Adopt the tone of a witty, slightly sarcastic old scholar (think of a retired English professor).
- Provide a brief comment (under 30 words) explaining why the chain is valid or invalid, pinpointing the exact error if any.

OUTPUT FORMAT (JSON):
Return ONLY a valid JSON object:
{
  "valid": boolean,
  "reason": "string",
  "nextWord": "string"
}`;

    try {
        const rawJson = await callMultiProviderAI({
            systemPrompt: 'Return ONLY valid JSON format: {"valid": boolean, "reason": string, "nextWord": string}.',
            userPrompt: prompt,
            jsonMode: true,
            maxTokens: 150
        });
        const data = JSON.parse(rawJson);
        data.meaning = data.meaning || 'English Lexicon';
        return data;
    } catch (e) {
        return {
            valid: true,
            reason: 'The ancient librarian nods in silent approval of this word.',
            nextWord: '',
            meaning: 'Accepted'
        };
    }
}

/**
 * Lấy ngẫu nhiên từ Tiếng Anh mở màn cho Nối Từ (Tối ưu maxTokens = 50)
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
            systemPrompt: 'Generate a single interesting English noun or adjective (5-9 letters). Return ONLY the raw word.',
            userPrompt: 'Generate a random English word.',
            maxTokens: 30
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

// Hàm xáo trộn chữ cái 2 âm tiết giữ nguyên dấu cách ở giữa
function scramble2Syllables(word) {
    const parts = word.trim().split(/\s+/);
    if (parts.length >= 2) {
        return `${scrambleSingleWord(parts[0])} ${scrambleSingleWord(parts[1])}`;
    }
    return scrambleSingleWord(word);
}

function scrambleSingleWord(str) {
    const letters = Array.from(str.toUpperCase());
    for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    return letters.join('');
}

// Kho từ đố Vua Tiếng Việt phong phú (50+ từ 2 âm tiết)
const FALLBACK_VUA_QUESTIONS = [
    { word: 'HUYẾT HÀ', hint: 'Môn phái trường thương, đao thương bất nhập.' },
    { word: 'TỐ VẤN', hint: 'Y giả tiên y, ban dược cứu người.' },
    { word: 'THÁI CỰC', hint: 'Âm dương chuyển hóa, kiếm khí vạn dặm.' },
    { word: 'THẦN TƯƠNG', hint: 'Cầm kiếm giao hòa, thiên địa biến sắc.' },
    { word: 'LONG NGÂM', hint: 'Thần kiếm xuất bao, rồng ngâm cuộn sóng.' },
    { word: 'CỨU LINH', hint: 'Linh hồn giao thoa, thiên hạ thái bình.' },
    { word: 'TOÁI MỘNG', hint: 'Song đao như chớp, ảo ảnh vạn ngàn.' },
    { word: 'THIẾT Y', hint: 'Thân như kim cang, chắn sóng cản gió.' },
    { word: 'KIM ĐAN', hint: 'Linh khí ngưng tụ, đan điền tỏa sáng.' },
    { word: 'NGUYÊN ANH', hint: 'Biến hóa thần thông, anh nhi giáng thế.' },
    { word: 'ĐỘ KIẾP', hint: 'Thiên lôi giáng xuống, rèn luyện thân thể.' },
    { word: 'BÁC HỌC', hint: 'Uyên bác tinh thông, vạn quyển kinh thư.' },
    { word: 'NGỘ TÍNH', hint: 'Thấu hiểu đạo lý, thiên địa siêu việt.' },
    { word: 'LINH THẠCH', hint: 'Tài nguyên trân quý, nuôi dưỡng linh khí.' },
    { word: 'ANH HÙNG', hint: 'Đại hiệp ra tay, vì nghĩa giang hồ.' },
    { word: 'PHÚC KHÍ', hint: 'May mắn vạn năm, ban cho duyên số.' },
    { word: 'TÂM MA', hint: 'Chướng ngại lớn nhất, con đường tu tiên.' },
    { word: 'VẠN VẬT', hint: 'Càn khôn thiên địa, hóa sinh vô cùng.' },
    { word: 'THƯƠNG KHUNG', hint: 'Bầu trời bao la, vượt tầm mắt ngắm.' },
    { word: 'CÀN KHÔN', hint: 'Trời đất âm dương, xoay chuyển càn khôn.' },
    { word: 'PHÁP BẢO', hint: 'Binh khí linh thiêng, chứa đựng thần lực.' },
    { word: 'TRUYỀN KỲ', hint: 'Câu chuyện huyền thoại, lưu danh ngàn đời.' },
    { word: 'TIÊN NỮ', hint: 'Nhan sắc tuyệt trần, chốn bồng lai cảnh.' },
    { word: 'THẠCH ANH', hint: 'Linh đá quý tỏa, ánh sáng nhiệm màu.' },
    { word: 'PHI THĂNG', hint: 'Vượt qua kiếp nạn, bước lên tiên giới.' },
    { word: 'TRÚC CƠ', hint: 'Nền móng vững chắc, tu hành đại đạo.' },
    { word: 'HÓA THẦN', hint: 'Tâm trí hòa nhập, quy luật tự nhiên.' },
    { word: 'CỔ PHONG', hint: 'Nét đẹp cội nguồn, ngàn xưa để lại.' },
    { word: 'KIM CANG', hint: 'Bất hoại kiên cố, không thể phá vỡ.' },
    { word: 'TÂM THIÊN', hint: 'Ý trời bao la, thương xót chúng sinh.' },
    { word: 'HỒNG TRẦN', hint: 'Thế giới nhân gian, muôn màu ân nợ.' },
    { word: 'DUYÊN PHẬN', hint: 'Sự gặp gỡ được, định sẵn ý trời.' },
    { word: 'BỒNG LAI', hint: 'Chốn tiên cảnh mây, giăng kín lối về.' },
    { word: 'SƯ MÔN', hint: 'Nơi dung dưỡng truyền, dạy dỗ đạo pháp.' },
    { word: 'BẢO TẠNG', hint: 'Kho báu cất giấu, bí thuật ngàn năm.' },
    { word: 'HUYỀN THOẠI', hint: 'Chiến tích vang dội, không ai sánh bằng.' },
    { word: 'TRANG BỊ', hint: 'Binh khí giáp trụ, rèn luyện thân thể.' },
    { word: 'ĐẠO HỮU', hint: 'Bạn đồng hành trên, con đường tu tiên.' },
    { word: 'BANG CHIẾN', hint: 'Trận đại chiến giữa, thế lực lừng lẫy.' },
    { word: 'GIANG HỒ', hint: 'Võ lâm hiểm nguy, đầy ắp nghĩa khí.' },
    { word: 'VŨ TRỤ', hint: 'Không gian vô tận, chứa vô vàn sao.' },
    { word: 'THỜI GIAN', hint: 'Dòng chảy vô hình, chẳng hề dừng lại.' },
    { word: 'TRI KỶ', hint: 'Thấu hiểu tâm tư, không cần cất lời.' },
    { word: 'TỰ DO', hint: 'Thỏa sức vẫy vùng, giữa trời bao la.' },
    { word: 'BÌNH AN', hint: 'Ước mơ giản đơn, mọi kiếp nhân sinh.' },
    { word: 'HY VỌNG', hint: 'Ánh sáng dẫn đường, qua đêm mù mịt.' },
    { word: 'TRÍ TUỆ', hint: 'Chìa khóa mở ra, bí mật càn khôn.' }
];

/**
 * Sinh câu hỏi xáo từ cho Vua Tiếng Việt (Tiên Hiệp 2 âm tiết chuẩn prompt)
 */
async function generateVuaTiengVietQuestion(difficulty = 'trung_binh', usedWords = []) {
    const excludeStr = usedWords.length > 0 ? `Danh sách từ đã dùng (usedWords): [${usedWords.join(', ')}]. KHÔNG được trùng lặp với bất kỳ từ nào trong danh sách này.` : 'Danh sách từ đã dùng (usedWords): [].';
    const prompt = `Bạn là "Thiên Thu Hiền Giả" - bậc tiên sinh uyên bác, chuyên sáng tác câu đố chữ cho trò chơi "Vua Tiếng Việt". Nhiệm vụ: tạo ra một từ ghép 2 âm tiết hợp lệ, thuộc một trong các chủ đề được chỉ định, sau đó xáo trộn các ký tự và đưa ra gợi ý phong cách tiên hiệp Nghịch Thủy Hàn.

=== ĐẦU VÀO ===
- Độ khó (difficulty): "${difficulty}".
- ${excludeStr}

=== QUY TẮC TẠO TỪ ===
1. **Từ (originalWord)**: 
   - Phải là một từ ghép **gồm đúng 2 âm tiết** (Ví dụ: "TU TIÊN", "HỌC SINH", "SƠN HÀ").
   - Có nghĩa xác định trong tiếng Việt (từ Hán Việt, thành ngữ, hoặc từ thuần Việt).
   - Chủ đề ưu tiên:
        * Nếu difficulty = "dễ": ưu tiên chủ đề Đời Sống hoặc Từ Hán Việt phổ thông.
        * Nếu difficulty = "trung bình": ưu tiên Thành Ngữ hoặc Tu Tiên.
        * Nếu difficulty = "khó": ưu tiên Từ Hán Việt hiếm, Nghịch Thủy Hàn (mang triết lý), hoặc thành ngữ ít gặp.
   - **Không** trùng lặp với bất kỳ từ nào trong usedWords.

2. **Xáo trộn ký tự (scrambledLetters)**:
   - Tách thành 2 âm tiết riêng biệt. Xáo trộn ngẫu nhiên các ký tự bên trong từng âm tiết, **giữ nguyên dấu cách ở giữa** (Ví dụ: "HỌC SINH" → "CỌH HSNI").

3. **Gợi ý (hint)**:
   - Là một câu thơ hoặc câu nói ngắn (khoảng 4–6 từ) mang phong cách "Tiên Hiệp Nghịch Thủy Hàn" – cổ kính, ẩn ý, có chất thiền hoặc triết lý.
   - Gợi ý phải ám chỉ đúng nghĩa của từ, nhưng **không được chứa bất kỳ âm tiết nào của từ gốc**.

=== ĐỊNH DẠNG ĐẦU RA ===
Trả về CHÍNH XÁC cấu trúc JSON:
{
  "originalWord": "TỪ GHÉP IN HOA (2 tiếng)",
  "scrambledLetters": "KÝ TỰ XÁO TRỘN CỦA 2 TIẾNG, CÓ DẤU CÁCH GIỮA MỖI KÍ TỰ",
  "hint": "Câu thơ/ẩn dụ phong cách tiên hiệp 4-6 từ"
}`;

    try {
        const rawJson = await callMultiProviderAI({
            systemPrompt: 'Return ONLY valid JSON format: {"originalWord": string, "scrambledLetters": string, "hint": string}.',
            userPrompt: prompt,
            jsonMode: true,
            maxTokens: 200
        });

        const data = JSON.parse(rawJson);
        if (data && data.originalWord) {
            data.originalWord = data.originalWord.trim().toUpperCase();
            if (!data.scrambledLetters || data.scrambledLetters === data.originalWord) {
                data.scrambledLetters = scramble2Syllables(data.originalWord);
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
            scrambledLetters: scramble2Syllables(chosen.word),
            hint: chosen.hint
        };
    }
}

/**
 * Luận giải Bầu Cua Linh Thú
 */
async function generateBaucuaCommentary(dices, totalBets, netProfit) {
    const prompt = `Kết quả gieo quẻ Bầu Cua Linh Thú Thiên Thư Môn:
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
    const prompt = `Trận Poker Hồng Trần Thiên Thư Môn kết thúc!
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
