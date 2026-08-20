const { google } = require('googleapis');
const { getAuth } = require('./googleAuth');
const config = require('./config');

async function appendRow(values) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetId,
    range: `${config.googleSheetTabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
}

module.exports = { appendRow };
