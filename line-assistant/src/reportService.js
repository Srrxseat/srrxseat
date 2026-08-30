const { readRows, updateRange } = require('./sheetsService');
const { deriveVisitColumns, monthKey, summarizeMonth, formatMonthlyReport } = require('./attendanceStats');
const config = require('./config');

// Column layout of the drop-in log tab. A..J are written when a photo arrives;
// K..M are derived and rewritten in full afterwards.
const FIRST_DERIVED_COLUMN = 'K';
const LAST_DERIVED_COLUMN = 'M';
const HEADER_ROWS = 1;

function toRecords(sheetRows) {
  return sheetRows.slice(HEADER_ROWS).map((row, index) => ({
    date: (row[0] || '').trim(),
    session: (row[1] || '').trim(),
    name: (row[2] || '').trim(),
    nationality: (row[3] || '').trim(),
    index,
  }));
}

async function readLog() {
  return toRecords(await readRows(config.googleSheetLogTabName));
}

// Recomputed for every row rather than appended for the new ones: a page from
// earlier in the month can be photographed after a later one, which shifts the
// visit numbering of rows already in the sheet.
async function refreshDerivedColumns(records) {
  if (!records.length) return;
  const derived = deriveVisitColumns(records);
  const firstRow = HEADER_ROWS + 1;
  const lastRow = HEADER_ROWS + records.length;
  const range = `${config.googleSheetLogTabName}!${FIRST_DERIVED_COLUMN}${firstRow}:${LAST_DERIVED_COLUMN}${lastRow}`;
  await updateRange(range, derived.map((cell) => (cell
    ? [cell.person, cell.visitNumber, cell.totalVisits]
    : ['', '', ''])));
}

function latestMonth(records) {
  return records
    .map((record) => monthKey(record.date))
    .filter(Boolean)
    .sort()
    .pop() || '';
}

async function buildMonthlyReport(month, records) {
  const rows = records || await readLog();
  const target = month || latestMonth(rows);
  if (!target) return null;
  return formatMonthlyReport(summarizeMonth(rows, target));
}

module.exports = { readLog, refreshDerivedColumns, buildMonthlyReport, latestMonth, monthKey };
