const { emit } = require('./output');

async function runListMonths(drive) {
  await drive.ensureFolders();
  const months = await drive.listMonths();
  emit({ ok: true, command: 'list-months', months });
  return 0;
}

module.exports = { runListMonths };
