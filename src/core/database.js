const mongoose = require('mongoose');

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Kết nối MongoDB thành công');
    } catch (err) {
        console.error('❌ MongoDB lỗi:', err);
        process.exit(1);
    }
}

module.exports = { connectDB };
