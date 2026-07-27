const diemdanh = require('./commands/diemdanh');
const danhsach = require('./commands/danhsach');
const xoa = require('./commands/xoa');
const ghichu = require('./commands/ghichu');

const handleSelectClass = require('./interactions/selectClass');
const handleSelectRole = require('./interactions/selectRole');
const { handleNoteButton, handleCancelButton, handleStatusButton } = require('./interactions/buttons');
const handleNoteModal = require('./interactions/noteModal');

module.exports = {
  // Slash commands
  commands: [diemdanh, danhsach, xoa, ghichu],

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
  },
};
