require('dotenv').config();

(async () => {
    console.log('Testing Gemini Embedding...');
    const geminiKey = process.env.GEMINI_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;

    // Test Gemini text-embedding-004
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: { parts: [{ text: 'Xin chào Thiên Thư Hiền Giả' }] }
            })
        });
        console.log('Gemini text-embedding-004 Status:', res.status);
        if (res.ok) {
            const data = await res.json();
            console.log('✅ Gemini Embedding success! Dimension:', data.embedding?.values?.length);
            return;
        } else {
            console.log('Gemini Err Body:', await res.text());
        }
    } catch (e) {
        console.log('Gemini Exception:', e.message);
    }

    // Test OpenRouter embedding (openai/text-embedding-3-small)
    if (openrouterKey) {
        console.log('\nTesting OpenRouter Embedding (openai/text-embedding-3-small)...');
        try {
            const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openrouterKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'openai/text-embedding-3-small',
                    input: 'Xin chào Thiên Thư Hiền Giả'
                })
            });
            console.log('OpenRouter Status:', res.status);
            if (res.ok) {
                const data = await res.json();
                console.log('✅ OpenRouter Embedding success! Dimension:', data.data?.[0]?.embedding?.length);
            } else {
                console.log('OpenRouter Err Body:', await res.text());
            }
        } catch (e) {
            console.log('OpenRouter Exception:', e.message);
        }
    }
})();
