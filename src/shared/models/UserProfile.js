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
    stats: {
        noituWins: { type: Number, default: 0 },
        vuatiengvietWins: { type: Number, default: 0 },
        baucuaGames: { type: Number, default: 0 },
        baucuaWinLinhThach: { type: Number, default: 0 },
        pokerGames: { type: Number, default: 0 },
        pokerWins: { type: Number, default: 0 },
    }
}, { timestamps: true });

/**
 * Lấy hoặc tạo hồ sơ tu sĩ
 */
UserProfileSchema.statics.getOrCreate = async function (userId, username = 'Đạo hữu') {
    let profile = await this.findOne({ userId });
    if (!profile) {
        profile = await this.create({ userId, username });
    }
    return profile;
};

/**
 * Tăng Tu Vi và tự động cập nhật Cảnh Giới
 */
UserProfileSchema.methods.addTuVi = function (amount) {
    this.tuVi += amount;
    
    // Tìm cảnh giới phù hợp
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
