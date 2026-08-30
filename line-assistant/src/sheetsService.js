const { google } = require('googleapis');
const { getAuth } = require('./googleAuth');
const config = require('./config');

async function appendRows(tabName, rows) {
  if (!rows.length) return;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

async function appendRow(values) {
  await appendRows(config.googleSheetTabName, [values]);
}

// Used to spot entries already recorded from an earlier photo of the same
// page. A missing tab is not an error here - it just means nothing has been
// recorded yet, and the append that follows will report the real problem if
// the tab genuinely doesn't exist.
async function readRows(tabName) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetId,
      range: tabName,
    });
    return res.data.values || [];
  } catch (err) {
    console.warn(`[sheetsService] could not read "${tabName}" (${err.message}) - treating it as empty`);
    return [];
  }
}

// Overwrites an exact block of cells. Used for the derived Person / Visit #
// columns, which are recomputed for every row after each append - an older page
// photographed later changes the visit numbering of rows already written, so
// they can't just be appended once and left alone.
async function updateRange(range, rows) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.googleSheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

module.exports = { appendRow, appendRows, readRows, updateRange };
