const XLSX = require('xlsx');

/**
 * Parse a month name like "Apr26" or "jan2026" into { month: 4, year: 2026 }.
 * Returns null if the name can't be parsed.
 */
function parseMonthFilter(name) {
  if (!name) return null;
  const ORDER = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const lc = name.toLowerCase();
  const mi = ORDER.findIndex(m => lc.startsWith(m));
  if (mi === -1) return null;
  const yearMatch = lc.match(/\d+/);
  if (!yearMatch) return null;
  let year = parseInt(yearMatch[0]);
  if (year < 100) year += 2000;
  return { month: mi + 1, year };
}

/**
 * Reads the credit card Excel file and returns an array of transactions.
 * Each transaction: { merchant, amount, date, notes, source: 'credit' }
 * monthFilter (optional) restricts the "pending transactions" sheet to that month/year,
 * matching the web app's handling of עסקאות שטרם נקלטו.
 */
function parseSheet(sheet, monthFilter) {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 });
  let headerRowIndex = rawRows.findIndex(row =>
    row.some(cell => String(cell).includes('תאריך עסקה'))
  );
  if (headerRowIndex === -1) return []; // no transaction table in this sheet

  const headers = rawRows[headerRowIndex];
  const dataRows = rawRows.slice(headerRowIndex + 1);

  const colIndex = {};
  headers.forEach((h, i) => { colIndex[String(h).trim()] = i; });

  const merchantCol = colIndex['שם בית העסק'];
  const amountColPrimary  = colIndex['סכום חיוב'];          // filled for confirmed txs
  const amountColFallback = colIndex['סכום עסקה מקורי'];    // filled for pending txs
  const dateCol = colIndex['תאריך עסקה'];
  const notesCol = colIndex['הערות'];

  const transactions = [];

  for (const row of dataRows) {
    const merchant = row[merchantCol];
    const primaryRaw  = amountColPrimary  !== undefined ? row[amountColPrimary]  : '';
    const fallbackRaw = amountColFallback !== undefined ? row[amountColFallback] : '';
    const amountRaw = (primaryRaw !== '' && primaryRaw !== undefined) ? primaryRaw : fallbackRaw;
    const date = row[dateCol];

    if (!merchant || typeof merchant !== 'string' && typeof merchant !== 'number') continue;
    if (amountRaw === '' || amountRaw === undefined) continue;

    const amount = parseAmount(amountRaw);
    if (isNaN(amount) || amount === 0) continue;

    // For the pending sheet, skip rows whose transaction date is outside the target month
    if (monthFilter) {
      const dateStr = String(date || '');
      const parts = dateStr.split(/[-\/]/);
      if (parts.length >= 3) {
        const rowMonth = parseInt(parts[1]);
        let rowYear = parseInt(parts[2]);
        if (rowYear < 100) rowYear += 2000;
        if (rowMonth !== monthFilter.month || rowYear !== monthFilter.year) continue;
      }
    }

    const notes = notesCol !== undefined ? String(row[notesCol] || '').trim() : '';
    transactions.push({
      merchant: String(merchant).trim(),
      amount,
      date: String(date || '').trim(),
      notes,
      source: 'credit'
    });
  }

  return transactions;
}

/**
 * filePath: path to the .xlsx file on disk.
 * monthFilter (optional): { month, year } — restricts the "pending transactions" sheet.
 */
function parseExcel(filePath, monthFilter) {
  const workbook = XLSX.readFile(filePath);
  const all = [];
  for (const sheetName of workbook.SheetNames) {
    // Only filter the pending-transactions sheet by month/year
    const isPending = sheetName.includes('טרם נקלטו');
    all.push(...parseSheet(workbook.Sheets[sheetName], isPending ? monthFilter : null));
  }
  return all;
}

function parseAmount(raw) {
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).replace(/[₪,\s]/g, '');
  return parseFloat(cleaned);
}

module.exports = { parseExcel, parseMonthFilter };
