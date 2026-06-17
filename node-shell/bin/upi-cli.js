const { main } = require('../src/index.js');

if (require.main === module) {
  main();
}

module.exports = { main };
