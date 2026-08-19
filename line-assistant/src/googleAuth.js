const { google } = require('googleapis');
const config = require('./config');

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

function getAuth() {
  if (config.googleServiceAccountKeyJson) {
    const credentials = JSON.parse(config.googleServiceAccountKeyJson);
    return new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  }
  return new google.auth.GoogleAuth({ scopes: SCOPES });
}

module.exports = { getAuth };
