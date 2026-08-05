const mongoose = require('mongoose');

const CANH_GIOI_LIST = [
    { name: 'Luyện Khí Sơ Kỳ', reqTuVi: 0 },
    { name: 'Luyện Khí Trung Kỳ', reqTuVi: 100 },
    { name: 'Luyện Khí Hậu Kỳ', reqTuVi: 300 },
    { name: 'Trúc Cơ Sơ Kỳ', reqTuVi: 600 },
    { name: 'Trúc Cơ Trung Kỳ', reqTuVi: 1000 },
    { name: 'Trúc Cơ Hậu Kỳ', reqTuVi: 1500 },
    { name: 'Kim Đan Sơ Kỳ', reqTuVi: 2500 },
    { name: 'Kim Đan Trung Kỳ', reqTuVi: 4000 },
    { name: 'Kim Đan Hậu Kỳ', reqTuVi: 6000 },
    { name: 'Nguyên Anh Sơ Kỳ', reqTuVi: 9000 },
    { name: 'Nguyên Anh Trung Kỳ', reqTuVi: 13000 },
    { name: 'Nguyên Anh Hậu Kỳ', reqTuVi: 18000 },
    { name: 'Hóa Thần Viên Mãn', reqTuVi: 25000 },
    { name: 'Độ Kiếp Thành Tiên', reqTuVi: 50000 },
];

const UserProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    username: { type: String, default: 'Đạo hữu' },
    linhThach: { type: Number, default: 1000 },
    tuVi: { type: Number, default: 0 },
    canhGioi: { type: String, default: 'Luyện Khí Sơ Kỳ' },
    lastDiemDanh: { type: Date, default: null },

    // Đạo Lữ (Hệ thống Kết Đôi / Cầu Hôn)
    daoLu: {
        partnerId: { type: String, default: null },
        partnerName: { type: String, default: null },
        ringName: { type: String, default: null },
        intimacy: { type: Number, default: 0 },
        marriedAt: { type: Date, default: null }
    },

    // Giới hạn Động Tác (10 lần / 6h)
    gestureUsage: {
        count: { type: Number, default: 0 },
        windowStart: { type: Date, default: Date.now }
    },

    // Quản lý Trứng Linh Thú (Max 5 trứng/ngày)
    eggData: {
        eggCount: { type: Number, default: 0 },
        eggsBoughtToday: { type: Number, default: 0 },
        lastBuyDate: { type: String, default: '' }
    },

    // Linh Thú Độc Nhất (Pet Slot = 1)
    pet: {
        name: { type: String, default: null },
        species: { type: String, default: null },
        rarity: { type: String, default: null },
        rarityIndex: { type: Number, default: 0 },
        element: { type: String, default: null }, // Kim, Mộc, Thủy, Hỏa, Thổ
        level: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
        stats: {
            hp: { type: Number, default: 100 },
            atk: { type: Number, default: 20 },
            def: { type: Number, default: 15 },
            spatk: { type: Number, default: 20 },
            spdef: { type: Number, default: 15 }
        },
        questsCompletedToday: { type: Number, default: 0 },
        lastQuestResetDate: { type: String, default: '' }
    },

    // (Giữ mảng pets cũ để tránh lỗi tương thích nếu cần)
    pets: [{
        petId: { type: String },
        name: { type: String },
        level: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
        lastFed: { type: Date, default: null }
    }],
    activePetId: { type: String, default: null },

    stats: {
        noituWins: { type: Number, default: 0 },
        vuatiengvietWins: { type: Number, default: 0 },
        baucuaGames: { type: Number, default: 0 },
        baucuaWinLinhThach: { type: Number, default: 0 },
        pokerGames: { type: Number, default: 0 },
        pokerWins: { type: Number, default: 0 },
    }
}, { timestamps: true });

UserProfileSchema.statics.getOrCreate = async function (userId, username = 'Đạo hữu') {
    let profile = await this.findOne({ userId });
    let needsSave = false;

    if (!profile) {
        profile = await this.create({ userId, username });
        return profile;
    }

    if (username && profile.username !== username) {
        profile.username = username;
        needsSave = true;
    }

    if (!profile.eggData) {
        profile.eggData = { eggCount: 0, eggsBoughtToday: 0, lastBuyDate: '' };
        needsSave = true;
    } else {
        if (typeof profile.eggData.eggCount !== 'number') {
            profile.eggData.eggCount = 0;
            needsSave = true;
        }
        if (typeof profile.eggData.eggsBoughtToday !== 'number') {
            profile.eggData.eggsBoughtToday = 0;
            needsSave = true;
        }
        if (typeof profile.eggData.lastBuyDate !== 'string') {
            profile.eggData.lastBuyDate = '';
            needsSave = true;
        }
    }

    if (needsSave) {
        await profile.save();
    }

    return profile;
};

UserProfileSchema.methods.addTuVi = function (amount) {
    this.tuVi += amount;
    
    let currentRealm = CANH_GIOI_LIST[0].name;
    for (const realm of CANH_GIOI_LIST) {
        if (this.tuVi >= realm.reqTuVi) {
            currentRealm = realm.name;
        } else {
            break;
        }
    }
    this.canhGioi = currentRealm;
    return this.canhGioi;
};

module.exports = mongoose.model('UserProfile', UserProfileSchema);
module.exports.CANH_GIOI_LIST = CANH_GIOI_LIST;
