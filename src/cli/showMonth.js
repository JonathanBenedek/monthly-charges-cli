const { categorizeTransactions } = require('../categorize');
const { loadCoreData, computeActuals, round2, round2Map } = require('./context');
const { emit, emitFail } = require('./output');

async function runShowMonth(drive, { month }) {
  if (!month) return emitFail('show-month', 'missing --month');

  await drive.ensureFolders();
  const [core, monthlyData] = await Promise.all([
    loadCoreData(drive),
    drive.loadJSON(`months/${month}.json`)
  ]);

  if (!monthlyData) {
    return emitFail('show-month', `Month not found: ${month}`, [
      { code: 'MONTH_NOT_FOUND', message: `No saved data for month "${month}".` }
    ]);
  }

  const { categoryMap, overrides, alwaysManual, budgetData } = core;
  const txs = categorizeTransactions(monthlyData.__txs || [], categoryMap, monthlyData, overrides, alwaysManual);
  const actuals = computeActuals(txs);
  const needsReviewCount = txs.filter(t => t.needsReview && !t.excluded && !t.isIncome).length;

  emit({
    ok: true,
    command: 'show-month',
    month,
    summary: {
      transactionCount: txs.length,
      creditTransactionCount: txs.filter(t => t.source === 'credit').length,
      bankTransactionCount: txs.filter(t => t.source === 'bank').length,
      needsReviewCount,
      incomeTotal: round2(txs.filter(t => t.isIncome).reduce((s, t) => s + t.amount, 0)),
      categoryTotals: round2Map(actuals),
      savedBudgetActuals: budgetData.months[month] || null
    },
    transactions: txs.map(t => ({
      id: t.id, merchant: t.merchant, amount: t.amount, date: t.date, source: t.source,
      category: t.category, needsReview: t.needsReview, excluded: t.excluded,
      comment: t.comment, isIncome: !!t.isIncome
    }))
  });
  return 0;
}

module.exports = { runShowMonth };
