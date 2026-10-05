const fs = require('fs');
const pdfParse = require('pdf-parse');

// Transaction types to skip — these are credit card bill payments already in the Excel
const SKIP_PATTERNS = ['ויזה מקס', 'visa max'];

// Keywords that indicate income/credit transactions
const INCOME_KEYWORDS = ['משכורת', 'קיצבת', 'קצבת', 'זיכוי', 'airsource', 'איירונסורס'];

/**
 * Reads the bank statement PDF and returns an array of transactions.
 * Each transaction: { merchant, amount, date, source: 'bank', isIncome }
 *
 * Matches date…description…amount triplets anywhere in the extracted text (not
 * anchored to line starts), since pdf-parse's whitespace/line-break placement
 * around a date can vary by statement. This mirrors the web app's pdf.js-based
 * global-match approach in js/parseBankPDF.js.
 */
async function parseBankPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  const text = data.text;

  const transactions = [];
  // Date, then any text (lazy), then a signed decimal amount — whitespace between
  // groups is optional since pdf-parse sometimes concatenates fields with no space.
  const pattern = /(\d{2}\/\d{2}\/\d{2,4})\s*(.+?)\s*(-?[\d,]+\.\d{2})/g;

  for (const match of text.matchAll(pattern)) {
    const date = match[1];
    const description = match[2].trim();
    const amountStr = match[3].replace(/,/g, '');
    const amount = parseFloat(amountStr);

    if (!description || isNaN(amount)) continue;

    const descLower = description.toLowerCase();
    if (SKIP_PATTERNS.some(p => descLower.includes(p.toLowerCase()))) continue;

    const cleanDesc = description
      .replace(/\s*<\s*/g, '')
      .replace(/\)[יפ]\(/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const isIncome = amount > 0 ||
      INCOME_KEYWORDS.some(kw => descLower.includes(kw.toLowerCase()));

    transactions.push({
      merchant: cleanDesc || description,
      amount: Math.abs(amount),
      date,
      source: 'bank',
      isIncome: isIncome && amount > 0
    });
  }

  return transactions;
}

module.exports = { parseBankPDF };
