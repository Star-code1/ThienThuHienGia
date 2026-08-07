// test-ai.js
require('dotenv').config();
const {
    generateSageResponse,
    validateWordVI,
    validateWordEN,
    generateVuaTiengVietQuestion,
} = require('./src/services/aiService'); // sửa đúng đường dẫn thật của bạn

(async () => {
    console.log('--- Test generateSageResponse ---');
    console.log(await generateSageResponse('Vũ khí nào mạnh nhất cho Cái Bang?'));

    console.log('\n--- Test validateWordVI ---');
    console.log(await validateWordVI('Tu tiên', 'Tiên giới'));

    console.log('\n--- Test validateWordEN ---');
    console.log(await validateWordEN('apple', 'elephant'));

    console.log('\n--- Test generateVuaTiengVietQuestion ---');
    console.log(await generateVuaTiengVietQuestion());
})();