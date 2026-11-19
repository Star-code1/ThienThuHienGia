const mongoose = require('mongoose');

/** Mỗi bài trong kho kiến thức game (1 URL) — dùng để nạp tiếp/nạp lại không trùng. */
const KnowledgeDocSchema = new mongoose.Schema({
    url: { type: String, required: true, unique: true },
    source: { type: String, required: true, index: true }, // vd 'vnwiki'
    title: { type: String, default: '' },
    contentHash: { type: String, default: '' },
    chunkCount: { type: Number, default: 0 },
    status: { type: String, enum: ['ok', 'empty', 'duplicate', 'error'], default: 'ok', index: true },
    error: { type: String, default: '' },
    duplicateOf: { type: String, default: '' }, // trùng nội dung với bài này (cùng bài ở 2 địa chỉ)
    ingestedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('KnowledgeDoc', KnowledgeDocSchema);
