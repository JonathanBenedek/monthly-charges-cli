const INCOME_CATEGORY = 'הכנסה';

// Loads the shared root-level Drive files every command needs, with the same
// defaulting as js/app.js's init().
async function loadCoreData(drive) {
  const [catsArr, overrides, alwaysManual, budgetRaw] = await Promise.all([
    drive.loadJSON('categories.json'),
    drive.loadJSON('category-overrides.json'),
    drive.loadJSON('always-manual.json'),
    drive.loadJSON('budget.json')
  ]);
  const categoryMap = catsArr ? new Map(catsArr) : new Map();
  const budgetData = {
    planned: (budgetRaw && budgetRaw.planned) || {},
    months: (budgetRaw && budgetRaw.months) || {},
    salaries: (budgetRaw && budgetRaw.salaries) || {}
  };
  return { categoryMap, overrides: overrides || {}, alwaysManual: alwaysManual || [], budgetData };
}

// Same actuals-by-category computation used throughout js/app.js.
function computeActuals(txs) {
  const actuals = {};
  for (const tx of txs) {
    if (!tx.isIncome && !tx.excluded && tx.amount > 0 && tx.category !== INCOME_CATEGORY) {
      actuals[tx.category] = (actuals[tx.category] || 0) + tx.amount;
    }
  }
  return actuals;
}

// Stable identity of a transaction across re-parses (survives index shifts).
function txSignature(tx) {
  return `${tx.date}|${tx.merchant}|${tx.amount}|${tx.source}`;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round2Map(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = round2(v);
  return out;
}

module.exports = { loadCoreData, computeActuals, txSignature, round2, round2Map, INCOME_CATEGORY };
