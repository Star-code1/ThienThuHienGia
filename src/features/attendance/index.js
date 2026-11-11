const diemdanh = require('./commands/diemdanh');
const danhsach = require('./commands/danhsach');
const xoa = require('./commands/xoa');
const ghichu = require('./commands/ghichu');
const nhacdiemdanh = require('./commands/nhacdiemdanh');
const xemdiem = require('./commands/xemdiem');
const ranking = require('./commands/ranking');
const xemvitri = require('./commands/xemvitri');
const thongkevang = require('./commands/thongkevang');
const { SlashCommandBuilder } = require('discord.js');

const vitri = {
  ...xemvitri,
  data: new SlashCommandBuilder()
    .setName('vitri')
    .setDescription('Xem vị trí, kỹ năng/trang bị & lưu ý của bạn trong trận Bang Chiến sắp tới')
    .addUserOption((opt) =>
      opt
        .setName('thanhvien')
        .setDescription('Chọn đệ tử cần xem vị trí (để trống sẽ xem của chính mình)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('sukien')
        .setDescription('Message ID của chiến kỳ cụ thể (mặc định: trận sắp tới gần nhất)')
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('congkhai')
        .setDescription('Hiển thị công khai trong kênh (mặc định: chỉ mình bạn thấy)')
        .setRequired(false)
    ),
};

const handleSelectClass = require('./interactions/selectClass');
const handleSelectRole = require('./interactions/selectRole');
const { handleNoteButton, handleCancelButton, handleStatusButton } = require('./interactions/buttons');
const handleNoteModal = require('./interactions/noteModal');
const handleRankingButtons = require('./interactions/rankingButtons');

module.exports = {
  // Slash commands
  commands: [diemdanh, danhsach, xoa, ghichu, nhacdiemdanh, xemdiem, ranking, xemvitri, vitri, thongkevang],

  // Interaction handlers keyed by customId prefix
  interactions: {
    'select_class': handleSelectClass,
    'select_role':  handleSelectRole,
    'btn_note':     handleNoteButton,
    'btn_cancel':   handleCancelButton,
    'btn_bench':    handleStatusButton,
    'btn_late':     handleStatusButton,
    'btn_tentative': handleStatusButton,
    'btn_absent':   handleStatusButton,
    'modal_note':   handleNoteModal,
    'btn_view_bxh_top': handleRankingButtons,
    'btn_view_my_rank': handleRankingButtons,
  },
};
