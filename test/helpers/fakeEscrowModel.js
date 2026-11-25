// Model GameEscrow giả (trong bộ nhớ) cho test — chỉ hỗ trợ các thao tác mà escrowService dùng.
const docs = [];
let seq = 0;

const matches = (doc, filter) => Object.entries(filter).every(([k, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && '$lt' in cond) return doc[k] < cond.$lt;
    return doc[k] === cond;
});

const applyUpdate = (doc, update) => {
    for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
    Object.assign(doc, update.$set || {});
};

const GameEscrow = {
    docs,
    reset() { docs.length = 0; },
    async updateOne(filter, update, { upsert = false } = {}) {
        let doc = docs.find((d) => matches(d, filter));
        if (!doc && upsert) { doc = { _id: `e${++seq}`, amount: 0, ...filter }; docs.push(doc); }
        if (doc) applyUpdate(doc, update);
    },
    async updateMany(filter, update) {
        for (const d of docs.filter((x) => matches(x, filter))) applyUpdate(d, update);
    },
    async deleteOne(filter) {
        const i = docs.findIndex((d) => matches(d, filter));
        if (i >= 0) docs.splice(i, 1);
    },
    async findOneAndDelete(filter) {
        const i = docs.findIndex((d) => matches(d, filter));
        return i >= 0 ? docs.splice(i, 1)[0] : null;
    },
    find(filter) {
        return { lean: async () => docs.filter((d) => matches(d, filter)).map((d) => ({ ...d })) };
    },
};

module.exports = GameEscrow;
