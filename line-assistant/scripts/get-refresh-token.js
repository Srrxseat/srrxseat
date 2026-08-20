require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first, then re-run this script.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'],
});

console.log('\n1. Open this URL in your browser and log in with the Google account that owns the Drive folder and Sheet:\n');
console.log(authUrl);
console.log('\n2. Approve access. This script will print your refresh token once you do.\n');

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, REDIRECT_URI);
  const code = reqUrl.searchParams.get('code');
  if (!code) return;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('Authorized! You can close this tab and go back to the terminal.');
    console.log('Add this to your .env as GOOGLE_OAUTH_REFRESH_TOKEN:\n');
    console.log(tokens.refresh_token);
  } catch (err) {
    res.end('Something went wrong, check the terminal.');
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(PORT);
