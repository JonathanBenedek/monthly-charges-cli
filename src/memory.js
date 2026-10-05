const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..', 'memory');
const BUDGET_FILE = path.join(BASE, 'budget.json');
const SAVINGS_FILE = path.join(BASE, 'savings.json');
const MONTHLY_BASE = path.resolve(__dirname, '..', 'monthly-data');

const OVERRIDES_FILE = path.join(BASE, 'category-overrides.json');
const ALWAYS_MANUAL_FILE = path.join(BASE, 'always-manual.json');

function loadOverrides() {
  try { return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')); }
  catch { return {}; }
}

function saveOverrides(data) {
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadAlwaysManual() {
  try { return JSON.parse(fs.readFileSync(ALWAYS_MANUAL_FILE, 'utf8')); }
  catch { return []; }
}

function saveAlwaysManual(list) {
  fs.writeFileSync(ALWAYS_MANUAL_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function addOverride(merchant, category) {
  const data = loadOverrides();
  data[merchant.trim()] = category;
  saveOverrides(data);
}

function addAlwaysManual(merchant) {
  const list = loadAlwaysManual();
  const m = merchant.trim();
  if (!list.includes(m)) {
    list.push(m);
    saveAlwaysManual(list);
  }
}

function removeAlwaysManual(merchant) {
  const list = loadAlwaysManual();
  saveAlwaysManual(list.filter(m => m !== merchant.trim()));
}

// --- Per-month transaction data ---

function monthlyFile(month) {
  return path.join(MONTHLY_BASE, `${month}.json`);
}

function loadMonthlyData(month) {
  try { return JSON.parse(fs.readFileSync(monthlyFile(month), 'utf8')); }
  catch { return {}; }
}

function saveMonthlyData(month, data) {
  fs.writeFileSync(monthlyFile(month), JSON.stringify(data, null, 2), 'utf8');
}

function updateTransaction(month, txId, patch) {
  const data = loadMonthlyData(month);
  data[txId] = { ...(data[txId] || {}), ...patch };
  saveMonthlyData(month, data);
  return data[txId];
}

function loadBudget() {
  try {
    const raw = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
    // Support both old flat format and new { planned, months } format
    if (raw.planned !== undefined) return raw;
    return { planned: raw, months: {} };
  }
  catch { return { planned: {}, months: {} }; }
}

function saveBudget(data) {
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadSavings() {
  try { return JSON.parse(fs.readFileSync(SAVINGS_FILE, 'utf8')); }
  catch { return { initial: {}, assignments: {} }; }
}

function saveSavings(data) {
  fs.writeFileSync(SAVINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Save this month's category actuals (called automatically when a month is processed)
function saveMonthActuals(month, actuals) {
  const budget = loadBudget();
  budget.months = budget.months || {};
  budget.months[month] = actuals;
  saveBudget(budget);
}

// --- Signature-based migration (preserves edits across file re-uploads) ---

// Stable key for a transaction regardless of its index
function txSignature(tx) {
  return `${tx.date}|${tx.merchant}|${tx.amount}|${tx.source}`;
}

// Build map: signature → saved edits, from the current state
function buildSignatureMap(transactions, monthlyData) {
  const map = {};
  for (const tx of transactions) {
    const saved = monthlyData[tx.id];
    if (saved && Object.keys(saved).length > 0) {
      map[txSignature(tx)] = saved;
    }
  }
  return map;
}

// Re-assign saved edits to new transactions by signature match
// Returns { newMonthlyData, newCount }
function migrateMonthlyData(newTransactions, signatureMap) {
  const newData = {};
  let newCount = 0;
  for (const tx of newTransactions) {
    const sig = txSignature(tx);
    if (signatureMap[sig]) {
      newData[tx.id] = signatureMap[sig];
    } else {
      newCount++;
    }
  }
  return { newData, newCount };
}

function deleteMonthData(month) {
  // Remove from budget.months
  const budget = loadBudget();
  if (budget.months && budget.months[month] !== undefined) {
    delete budget.months[month];
    saveBudget(budget);
  }
  // Remove from savings.assignments
  const savings = loadSavings();
  if (savings.assignments && savings.assignments[month] !== undefined) {
    delete savings.assignments[month];
    saveSavings(savings);
  }
  // Remove monthly-data file
  const mFile = monthlyFile(month);
  if (fs.existsSync(mFile)) fs.unlinkSync(mFile);
}

module.exports = {
  loadOverrides,
  saveOverrides,
  loadAlwaysManual,
  saveAlwaysManual,
  loadBudget,
  saveBudget,
  loadSavings,
  saveSavings,
  addOverride,
  addAlwaysManual,
  removeAlwaysManual,
  loadMonthlyData,
  saveMonthlyData,
  updateTransaction,
  saveMonthActuals,
  deleteMonthData,
  txSignature,
  buildSignatureMap,
  migrateMonthlyData
};
