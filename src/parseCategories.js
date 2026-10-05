const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

/**
 * Reads the categories PDF and returns a Map<normalizedMerchantName, category>.
 * The PDF has two columns: merchant name (right, Hebrew RTL) and category (left).
 */
async function parseCategories(categoriesPdfPath) {
  const dataBuffer = fs.readFileSync(categoriesPdfPath);
  const data = await pdfParse(dataBuffer);
  const text = data.text;

  const categoryMap = new Map();

  // The PDF text extraction produces lines. The two-column table tends to come out
  // as interleaved lines or as "category  merchantName" pairs depending on the PDF engine.
  // We'll look for known category names and use them as anchors.
  const knownCategories = [
    'אוכל', 'בגדים', 'בריאות', 'הוצאות לבית', 'חו"ל', 'חול', 'חשבונות',
    'ילדים', 'כיף', 'משכורת', 'מתנות', 'רכב', 'תחבורה', 'תרבות',
    'לבדוק ידני'
  ];

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let currentCategory = null;

  for (const line of lines) {
    // Check if the line IS a category name (standalone)
    const matchedCat = knownCategories.find(cat => line === cat || line.startsWith(cat + ' ') || line.endsWith(' ' + cat));

    if (matchedCat) {
      currentCategory = matchedCat;
      // The rest of the line after the category name might be a merchant
      const rest = line.replace(matchedCat, '').trim();
      if (rest) {
        categoryMap.set(normalizeKey(rest), matchedCat);
      }
      continue;
    }

    // If we have a category context and the line looks like a merchant name, map it
    if (currentCategory && line.length > 1) {
      // Lines that are just numbers or dates are skipped
      if (/^\d+$/.test(line)) continue;
      categoryMap.set(normalizeKey(line), currentCategory);
    }
  }

  // If the above heuristic yields too few entries, try a paired-line approach
  if (categoryMap.size < 5) {
    return parseCategoriesPaired(lines, knownCategories);
  }

  return categoryMap;
}

function parseCategoriesPaired(lines, knownCategories) {
  const categoryMap = new Map();
  // Try to find lines that contain both a merchant and a category on the same line
  for (const line of lines) {
    for (const cat of knownCategories) {
      if (line.includes(cat)) {
        const merchant = line.replace(cat, '').trim();
        if (merchant.length > 1) {
          categoryMap.set(normalizeKey(merchant), cat);
        }
        break;
      }
    }
  }
  return categoryMap;
}

function normalizeKey(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

module.exports = { parseCategories, normalizeKey };
