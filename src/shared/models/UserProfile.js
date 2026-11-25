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

    // Dấu vết các giao dịch giữ/trả tiền ở bàn chơi gần nhất (để khôi phục khi bot sập, xem escrowService)
    escrowTx: { type: [String], default: [] },

    stats: {
        noituWins: { type: Number, default: 0 },
        vuatiengvietWins: { type: Number, default: 0 },
        baucuaGames: { type: Number, default: 0 },
        baucuaWinLinhThach: { type: Number, default: 0 },
        pokerGames: { type: Number, default: 0 },
        pokerWins: { type: Number, default: 0 },
        blackjackGames: { type: Number, default: 0 },
        blackjackWins: { type: Number, default: 0 },
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

/**
 * Cộng/trừ Linh Thạch NGUYÊN TỬ ngay trên MongoDB (không ghi đè khi nhiều nơi cập nhật cùng lúc).
 * Giá trị trên document hiện tại được đồng bộ lại và KHÔNG bị đánh dấu sửa đổi,
 * nên gọi profile.save() sau đó cho các trường khác sẽ không ghi đè Linh Thạch.
 *
 * @param {number} delta  Số Linh Thạch cộng (dương) hoặc trừ (âm)
 * @param {object} [opts]
 * @param {boolean} [opts.requireFunds] Trừ chỉ khi đủ tiền; không đủ → trả về null, không đổi gì
 * @param {boolean} [opts.clampZero]    Trừ tối đa tới 0 (không để số dư âm)
 * @param {object}  [opts.inc]          Các trường số khác cộng cùng lúc, vd { 'stats.baucuaGames': 1 }
 * @returns {Promise<number|null>} Số Linh Thạch thực sự đã thay đổi, hoặc null nếu không đủ tiền
 */
UserProfileSchema.methods.incLinhThach = async function (delta, { requireFunds = false, clampZero = false, inc = {}, tx = null } = {}) {
    const result = await this.constructor.incLinhThachById(this.userId, delta, { requireFunds, clampZero, inc, tx });
    if (!result) return null;
    this.set('linhThach', result.linhThach);
    this.unmarkModified('linhThach');
    for (const key of Object.keys(inc)) {
        this.set(key, result.fields[key]);
        this.unmarkModified(key);
    }
    return result.applied;
};

/** Bản static của incLinhThach, dùng khi không có sẵn document. Trả về { applied, linhThach, fields } hoặc null. */
UserProfileSchema.statics.incLinhThachById = async function (userId, delta, { requireFunds = false, clampZero = false, inc = {}, tx = null } = {}) {
    delta = Math.trunc(Number(delta) || 0);
    const added = { $add: [{ $ifNull: ['$linhThach', 0] }, delta] };
    const set = { linhThach: clampZero ? { $max: [0, added] } : added };
    for (const [key, value] of Object.entries(inc)) {
        set[key] = { $add: [{ $ifNull: [`$${key}`, 0] }, value] };
    }

    // Ghi dấu giao dịch NGAY trong cùng thao tác nguyên tử với việc đổi số dư (giữ 100 dấu gần nhất)
    if (tx) set.escrowTx = { $slice: [{ $concatArrays: [{ $ifNull: ['$escrowTx', []] }, [tx]] }, -100] };

    const filter = { userId };
    if (requireFunds && delta < 0) filter.linhThach = { $gte: -delta };

    const before = await this.findOneAndUpdate(filter, [{ $set: set }], {
        returnDocument: 'before',
        updatePipeline: true,
        lean: true,
    });
    if (!before) return null;

    const oldBalance = before.linhThach || 0;
    const newBalance = clampZero ? Math.max(0, oldBalance + delta) : oldBalance + delta;
    const fields = {};
    for (const [key, value] of Object.entries(inc)) {
        const old = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), before) || 0;
        fields[key] = old + value;
    }
    return { applied: newBalance - oldBalance, linhThach: newBalance, fields };
};

/**
 * Chuyển Linh Thạch giữa 2 người: trừ người gửi (chỉ khi đủ tiền) rồi cộng người nhận.
 * @returns {Promise<boolean>} false nếu người gửi không đủ tiền
 */
UserProfileSchema.statics.transferLinhThach = async function (fromProfile, toProfile, amount) {
    const spent = await fromProfile.incLinhThach(-amount, { requireFunds: true });
    if (spent === null) return false;
    try {
        await toProfile.incLinhThach(amount);
    } catch (err) {
        await fromProfile.incLinhThach(amount).catch(() => {}); // hoàn lại người gửi
        throw err;
    }
    return true;
};

/** Các dấu vết giao dịch giữ/trả tiền ở bàn chơi của người chơi (xem escrowService). */
UserProfileSchema.statics.getEscrowTxs = async function (userId) {
    const doc = await this.findOne({ userId }, { escrowTx: 1 }).lean();
    return doc?.escrowTx || [];
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
