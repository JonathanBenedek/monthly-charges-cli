const fs = require('fs');
const path = require('path');
const { parseExcel, parseMonthFilter } = require('../parseExcel');
const { parseBankPDF } = require('../parseBankPDF');
const { categorizeTransactions, MANUAL_REVIEW } = require('../categorize');
const { loadCoreData, computeActuals, txSignature, round2, round2Map } = require('./context');
const { emit, emitFail } = require('./output');

function toPreviewTx(t) {
  return {
    id: t.id, merchant: t.merchant, amount: t.amount, date: t.date, source: t.source,
    category: t.category, needsReview: t.needsReview, isIncome: !!t.isIncome
  };
}

async function runAddMonth(drive, { month, excel, pdf, commit }) {
  if (!month) return emitFail('add-month', 'missing --month');
  if (!excel && !pdf) return emitFail('add-month', 'at least one of --excel or --pdf is required');
  if (excel && !fs.existsSync(excel)) return emitFail('add-month', `excel file not found: ${excel}`);
  if (pdf && !fs.existsSync(pdf)) return emitFail('add-month', `pdf file not found: ${pdf}`);

  const warnings = [];

  await drive.ensureFolders();
  const [core, existingData] = await Promise.all([
    loadCoreData(drive),
    drive.loadJSON(`months/${month}.json`)
  ]);
  const { categoryMap, overrides, alwaysManual, budgetData } = core;

  const existing = existingData || {};
  const oldTxs = existing.__txs || [];
  if (oldTxs.length > 0) {
    warnings.push({
      code: 'AMBIGUOUS_MONTH_EXISTS',
      message: `Month "${month}" already has ${oldTxs.length} saved transactions; this will overwrite them (signature-matched per-transaction overrides are preserved).`
    });
  }

  const monthFilter = parseMonthFilter(month);

  let creditTx, bankTx;
  if (excel) {
    creditTx = parseExcel(excel, monthFilter);
  } else {
    creditTx = oldTxs.filter(t => t.source === 'credit');
  }
  if (pdf) {
    bankTx = await parseBankPDF(pdf);
  } else {
    bankTx = oldTxs.filter(t => t.source === 'bank');
  }
  const allTx = [...creditTx, ...bankTx];

  // Signature-based migration: preserve saved per-transaction overrides across re-uploads.
  const monthlyData = { __txs: allTx };
  if (oldTxs.length > 0) {
    const sigMap = {};
    for (let i = 0; i < oldTxs.length; i++) {
      const saved = existing[`tx-${i}`];
      if (saved && Object.keys(saved).length > 0) sigMap[txSignature(oldTxs[i])] = saved;
    }
    for (let i = 0; i < allTx.length; i++) {
      const sig = txSignature(allTx[i]);
      if (sigMap[sig]) monthlyData[`tx-${i}`] = sigMap[sig];
    }
  }

  const txs = categorizeTransactions(allTx, categoryMap, monthlyData, overrides, alwaysManual);
  const actuals = computeActuals(txs);

  // Unmapped merchants — surfaced instead of silently accepted.
  const unmapped = {};
  for (const t of txs) {
    if (!t.isIncome && t.needsReview) {
      if (!unmapped[t.merchant]) unmapped[t.merchant] = { merchant: t.merchant, txCount: 0, totalAmount: 0 };
      unmapped[t.merchant].txCount++;
      unmapped[t.merchant].totalAmount += t.amount;
    }
  }
  for (const u of Object.values(unmapped)) {
    warnings.push({
      code: 'UNMAPPED_MERCHANT',
      merchant: u.merchant,
      txCount: u.txCount,
      totalAmount: round2(u.totalAmount),
      message: `No category mapping found for "${u.merchant}"; falls back to "${MANUAL_REVIEW}".`
    });
  }

  // Sanity-check vs. the previously saved actuals for this month, if any.
  const prevActuals = budgetData.months[month] || null;
  if (prevActuals) {
    for (const [cat, newVal] of Object.entries(actuals)) {
      const prevVal = prevActuals[cat] || 0;
      if (prevVal > 0 && Math.abs(newVal - prevVal) / prevVal > 0.5) {
        warnings.push({
          code: 'BUDGET_DELTA_LARGE',
          category: cat,
          previousActual: round2(prevVal),
          newActual: round2(newVal),
          message: `Category "${cat}" changed by more than 50% vs. its previously saved value — verify the uploaded files are correct.`
        });
      }
    }
  }

  const summary = {
    newTransactionCount: txs.length,
    creditTransactionCount: creditTx.length,
    bankTransactionCount: bankTx.length,
    needsReviewCount: txs.filter(t => t.needsReview && !t.isIncome).length,
    unmappedMerchants: Object.keys(unmapped),
    categoryTotals: round2Map(actuals),
    incomeTotal: round2(txs.filter(t => t.isIncome).reduce((s, t) => s + t.amount, 0))
  };

  if (!commit) {
    emit({
      ok: true, command: 'add-month', dryRun: true, month, warnings, summary,
      preview: { sampleTransactions: txs.slice(0, 20).map(toPreviewTx) },
      nextSteps: 'Re-run with --commit to write these changes to Drive. If there are UNMAPPED_MERCHANT warnings and accurate categorization matters, ask the user what category each one belongs to first — either fix categories.json/category-overrides.json beforehand, or commit and follow up with an edit-month patch.'
    });
    return 0;
  }

  budgetData.months[month] = actuals;
  const written = { monthFile: false, budgetFile: false, rawFiles: [] };

  try {
    await drive.saveJSON(`months/${month}.json`, monthlyData);
    written.monthFile = true;
  } catch (e) {
    warnings.push({ code: 'SAVE_FAILED', message: `Failed to save month file: ${e.message}` });
  }
  try {
    await drive.saveJSON('budget.json', budgetData);
    written.budgetFile = true;
  } catch (e) {
    warnings.push({ code: 'SAVE_FAILED', message: `Failed to save budget.json: ${e.message}` });
  }
  if (excel) {
    try { await drive.saveRawFile(month, excel); written.rawFiles.push(path.basename(excel)); }
    catch (e) { warnings.push({ code: 'RAW_FILE_UPLOAD_FAILED', message: `Excel raw upload failed: ${e.message}` }); }
  }
  if (pdf) {
    try { await drive.saveRawFile(month, pdf); written.rawFiles.push(path.basename(pdf)); }
    catch (e) { warnings.push({ code: 'RAW_FILE_UPLOAD_FAILED', message: `PDF raw upload failed: ${e.message}` }); }
  }

  emit({ ok: true, command: 'add-month', dryRun: false, month, warnings, summary, written });
  return 0;
}

module.exports = { runAddMonth };
