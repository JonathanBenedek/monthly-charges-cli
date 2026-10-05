const fs = require('fs');
const { categorizeTransactions, MANUAL_REVIEW } = require('../categorize');
const { loadCoreData, computeActuals, round2Map } = require('./context');
const { emit, emitFail } = require('./output');

// Resolve a patch entry's target to a stable tx-<i> id, either directly (fast
// path, valid within a single edit-month run since __txs never reorders here)
// or by exact signature match (robust path for a human-described transaction).
function resolveTarget(target, oldTxs, txs) {
  if (!target) return { error: true, code: 'TX_NOT_FOUND', message: 'Patch entry missing "target".' };
  if (target.id) {
    const tx = txs.find(t => t.id === target.id);
    if (!tx) return { error: true, code: 'TX_NOT_FOUND', message: `No transaction with id "${target.id}".` };
    return { id: target.id };
  }
  const { merchant, date, amount, source } = target;
  if (!merchant || !date || amount === undefined || !source) {
    return { error: true, code: 'TX_NOT_FOUND', message: 'target must have either "id" or all of {merchant, date, amount, source}.' };
  }
  const matches = [];
  for (let i = 0; i < oldTxs.length; i++) {
    const t = oldTxs[i];
    if (t.merchant === merchant && t.date === date && Number(t.amount) === Number(amount) && t.source === source) {
      matches.push(`tx-${i}`);
    }
  }
  if (matches.length === 0) {
    return { error: true, code: 'TX_NOT_FOUND', message: `No transaction matches signature ${merchant}|${date}|${amount}|${source}.` };
  }
  if (matches.length > 1) {
    return { error: true, code: 'TX_SIGNATURE_AMBIGUOUS', message: `${matches.length} transactions match this signature; resubmit using "target.id".`, matches };
  }
  return { id: matches[0] };
}

async function runEditMonth(drive, { month, patch: patchPath, commit }) {
  if (!month) return emitFail('edit-month', 'missing --month');
  if (!patchPath) return emitFail('edit-month', 'missing --patch');
  if (!fs.existsSync(patchPath)) return emitFail('edit-month', `patch file not found: ${patchPath}`);

  let patch;
  try { patch = JSON.parse(fs.readFileSync(patchPath, 'utf8')); }
  catch (e) { return emitFail('edit-month', `invalid patch JSON: ${e.message}`); }

  await drive.ensureFolders();
  const [core, monthlyData] = await Promise.all([
    loadCoreData(drive),
    drive.loadJSON(`months/${month}.json`)
  ]);
  if (!monthlyData) {
    return emitFail('edit-month', `Month not found: ${month}`, [
      { code: 'MONTH_NOT_FOUND', message: `No saved data for month "${month}".` }
    ]);
  }

  const { categoryMap, overrides, alwaysManual, budgetData } = core;
  const oldTxs = monthlyData.__txs || [];
  const txs = categorizeTransactions(oldTxs, categoryMap, monthlyData, overrides, alwaysManual);

  const warnings = [];
  const results = [];
  let overridesChanged = false, alwaysManualChanged = false;
  let appliedCount = 0, skippedCount = 0;

  for (const entry of (patch.transactions || [])) {
    const resolved = resolveTarget(entry.target, oldTxs, txs);
    if (resolved.error) {
      warnings.push({ code: resolved.code, message: resolved.message, target: entry.target, matches: resolved.matches });
      skippedCount++;
      results.push({ target: entry.target, applied: false, reason: resolved.code });
      continue;
    }

    const id = resolved.id;
    const tx = txs.find(t => t.id === id);
    if (!monthlyData[id]) monthlyData[id] = {};
    Object.assign(monthlyData[id], entry.set || {});

    if (entry.set) {
      if (entry.set.category !== undefined) { tx.category = entry.set.category; tx.needsReview = entry.set.category === MANUAL_REVIEW; }
      if (entry.set.excluded !== undefined) tx.excluded = entry.set.excluded;
      if (entry.set.comment !== undefined) tx.comment = entry.set.comment;
    }

    if (entry.rememberForFuture && entry.set && entry.set.category) {
      overrides[tx.merchant] = entry.set.category;
      overridesChanged = true;
      // Retroactively re-categorize other matching-merchant transactions in this
      // month that don't already have a manually-saved category.
      const merchantKey = tx.merchant.toLowerCase();
      for (const t of txs) {
        if (t.id === id || t.isIncome) continue;
        const tKey = t.merchant.toLowerCase();
        if (!tKey.includes(merchantKey) && !merchantKey.includes(tKey)) continue;
        const savedT = monthlyData[t.id];
        if (savedT && savedT.category) continue; // already manually overridden — leave it
        t.category = entry.set.category;
        t.needsReview = entry.set.category === MANUAL_REVIEW;
      }
    }

    if (entry.markAlwaysManual !== undefined) {
      if (entry.markAlwaysManual) {
        if (!alwaysManual.includes(tx.merchant)) alwaysManual.push(tx.merchant);
      } else {
        const idx = alwaysManual.indexOf(tx.merchant);
        if (idx !== -1) alwaysManual.splice(idx, 1);
      }
      alwaysManualChanged = true;
      tx.alwaysManual = entry.markAlwaysManual;
    }

    appliedCount++;
    results.push({ target: entry.target, applied: true, id });
  }

  const actuals = computeActuals(txs);
  budgetData.months[month] = actuals;

  if (patch.budget && patch.budget.planned) {
    Object.assign(budgetData.planned, patch.budget.planned);
  }
  if (patch.budget && patch.budget.salaries) {
    for (const [name, byMonth] of Object.entries(patch.budget.salaries)) {
      if (!budgetData.salaries[name]) budgetData.salaries[name] = {};
      Object.assign(budgetData.salaries[name], byMonth);
    }
  }

  const summary = { appliedCount, skippedCount, categoryTotals: round2Map(actuals), results };

  if (!commit) {
    emit({ ok: true, command: 'edit-month', dryRun: true, month, warnings, summary });
    return 0;
  }

  const written = { monthFile: false, budgetFile: false, overridesFile: false, alwaysManualFile: false };
  try { await drive.saveJSON(`months/${month}.json`, monthlyData); written.monthFile = true; }
  catch (e) { warnings.push({ code: 'SAVE_FAILED', message: `Failed to save month file: ${e.message}` }); }
  try { await drive.saveJSON('budget.json', budgetData); written.budgetFile = true; }
  catch (e) { warnings.push({ code: 'SAVE_FAILED', message: `Failed to save budget.json: ${e.message}` }); }
  if (overridesChanged) {
    try { await drive.saveJSON('category-overrides.json', overrides); written.overridesFile = true; }
    catch (e) { warnings.push({ code: 'SAVE_FAILED', message: `Failed to save category-overrides.json: ${e.message}` }); }
  }
  if (alwaysManualChanged) {
    try { await drive.saveJSON('always-manual.json', alwaysManual); written.alwaysManualFile = true; }
    catch (e) { warnings.push({ code: 'SAVE_FAILED', message: `Failed to save always-manual.json: ${e.message}` }); }
  }

  emit({ ok: true, command: 'edit-month', dryRun: false, month, warnings, summary, written });
  return 0;
}

module.exports = { runEditMonth };
