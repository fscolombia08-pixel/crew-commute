// Loads the browser scripts into Node (same order as index.html, without the UI).
const path = require('path');
const root = path.join(__dirname, '..');
['assets/js/core.js', 'data/airports.js', 'data/routes.js', 'data/meta.js', 'assets/js/airports.js',
 'assets/js/airlines.js', 'assets/js/store.js', 'assets/js/i18n.js',
 'assets/js/engine.js', 'assets/js/conditions.js', 'assets/js/score.js', 'assets/js/demo.js',
 'assets/js/api.js', 'assets/js/inbound.js']
  .forEach(f => require(path.join(root, f)));
module.exports = globalThis.CC;
