// Diagnostic: verifies the current .env's OAuth credentials can actually see
// GOOGLE_DRIVE_FOLDER_ID and GOOGLE_SHEET_ID, independent of Render. Run this
// locally after regenerating a refresh token to confirm the new token/scope
// actually works before touching Render's env vars.
require('dotenv').config();
const { google } = require('googleapis');

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
const sheetId = process.env.GOOGLE_SHEET_ID;

if (!clientId || !clientSecret || !refreshToken) {
  console.error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN in .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
oauth2Client.setCredentials({ refresh_token: refreshToken });

async function main() {
  console.log(`Refresh token (first/last 6 chars): ${refreshToken.slice(0, 6)}...${refreshToken.slice(-6)}`);

  console.log('\n1. Requesting an access token (checks the refresh token itself is valid)...');
  const { token } = await oauth2Client.getAccessToken();
  console.log('   OK - got an access token.');

  console.log('\n2. Checking which scopes that access token actually carries...');
  const tokenInfo = await oauth2Client.getTokenInfo(token);
  console.log('   Granted scopes:', tokenInfo.scopes.join(', '));
  if (!tokenInfo.scopes.includes('https://www.googleapis.com/auth/drive')) {
    console.log('   WARNING: full "drive" scope is NOT present - only narrower scopes were granted.');
    console.log('   This means the consent screen did not actually grant broad Drive access.');
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  console.log(`\n3. Looking up Drive folder ${folderId}...`);
  try {
    const res = await drive.files.get({ fileId: folderId, fields: 'id, name, mimeType, owners' });
    console.log('   OK - folder found:', res.data.name, '| owners:', (res.data.owners || []).map((o) => o.emailAddress).join(', '));
  } catch (err) {
    console.log('   FAILED:', err.message);
  }

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  console.log(`\n4. Looking up Sheet ${sheetId}...`);
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title' });
    console.log('   OK - sheet found:', res.data.properties.title);
  } catch (err) {
    console.log('   FAILED:', err.message);
  }
}

main().catch((err) => {
  console.error('\nUnexpected error:', err.response ? err.response.data : err.message);
  process.exit(1);
});
