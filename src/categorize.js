const { normalizeKey } = require('./parseCategories');
const { loadOverrides, loadAlwaysManual } = require('./memory');

const MANUAL_REVIEW = 'לבדוק ידני';
const INCOME_CATEGORY = 'הכנסה';

/**
 * Assigns a category to each transaction.
 * Priority: always-manual list > user memory overrides > category PDF map.
 * Also assigns a stable id and applies per-month saved data (excludes, comments).
 *
 * overrides/alwaysManual are optional — when omitted, they're read from the local
 * memory.js files (used by the existing local Node server). The Drive-backed CLI
 * passes them explicitly instead, since its source of truth is Drive, not local files.
 */
function categorizeTransactions(transactions, categoryMap, monthlyData = {}, overrides, alwaysManual) {
  if (overrides === undefined) overrides = loadOverrides();
  if (alwaysManual === undefined) alwaysManual = loadAlwaysManual();

  return transactions.map((tx, i) => {
    const id = `tx-${i}`;
    const saved = monthlyData[id] || {};

    // Bank income transactions
    if (tx.isIncome) {
      return {
        ...tx, id,
        category: saved.category || INCOME_CATEGORY,
        needsReview: false,
        excluded: saved.excluded || false,
        comment: saved.comment || '',
        alwaysManual: false
      };
    }

    // Check always-manual list (exact or partial match)
    const isAlwaysManual = alwaysManual.some(m =>
      tx.merchant.toLowerCase().includes(m.toLowerCase()) ||
      m.toLowerCase().includes(tx.merchant.toLowerCase())
    );

    let category;
    let needsReview;

    if (isAlwaysManual) {
      category = saved.category || MANUAL_REVIEW;
      needsReview = !saved.category;
    } else {
      // Check user memory overrides first
      const overrideKey = Object.keys(overrides).find(k =>
        tx.merchant.toLowerCase().includes(k.toLowerCase()) ||
        k.toLowerCase().includes(tx.merchant.toLowerCase())
      );

      if (overrideKey) {
        category = saved.category || overrides[overrideKey];
        needsReview = false;
      } else {
        const found = lookupCategory(tx.merchant, categoryMap);
        category = saved.category || found || MANUAL_REVIEW;
        needsReview = !saved.category && (!found || found === MANUAL_REVIEW);
      }
    }

    if (category === 'חול') category = 'חו"ל';

    return {
      ...tx, id,
      category,
      needsReview,
      excluded: saved.excluded || false,
      comment: saved.comment || '',
      alwaysManual: isAlwaysManual
    };
  });
}

function lookupCategory(merchant, categoryMap) {
  const key = normalizeKey(merchant);
  const keyReversed = reverseWords(key);
  const keyWords = significantWords(key);

  if (categoryMap.has(key)) return categoryMap.get(key);
  if (categoryMap.has(keyReversed)) return categoryMap.get(keyReversed);

  for (const [mapKey, cat] of categoryMap.entries()) {
    const mapKeyRev = reverseWords(mapKey);
    if (
      key.includes(mapKey) || mapKey.includes(key) ||
      keyReversed.includes(mapKey) || mapKey.includes(keyReversed) ||
      key.includes(mapKeyRev) || mapKeyRev.includes(key)
    ) {
      return cat;
    }

    const mapWords = significantWords(mapKey);
    if (keyWords.length >= 2 && mapWords.length >= 2) {
      const shorter = keyWords.length <= mapWords.length ? keyWords : mapWords;
      const longer = keyWords.length <= mapWords.length ? mapWords : keyWords;
      if (shorter.every(w => longer.some(lw => lw.includes(w) || w.includes(lw)))) {
        return cat;
      }
    }
  }

  return null;
}

function reverseWords(str) {
  return str.split(' ').reverse().join(' ');
}

function significantWords(str) {
  return str.split(/[\s.,"'()\-\/]+/).filter(w => w.length >= 3);
}

module.exports = { categorizeTransactions, MANUAL_REVIEW, INCOME_CATEGORY };
