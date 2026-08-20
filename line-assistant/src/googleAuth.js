const { google } = require('googleapis');
const config = require('./config');

function getAuth() {
  const oauth2Client = new google.auth.OAuth2(config.googleOAuthClientId, config.googleOAuthClientSecret);
  oauth2Client.setCredentials({ refresh_token: config.googleOAuthRefreshToken });
  return oauth2Client;
}

module.exports = { getAuth };
