const trapHandler = require('./events/trapHandler');

module.exports = {
  // Anti-spam không có slash commands
  commands: [],

  // Không có interaction handlers
  interactions: {},

  // Event handlers
  events: [trapHandler],
};
