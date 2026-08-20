require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  },
  allowedGroupIds: (process.env.ALLOWED_GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  googleOAuthRefreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleSheetTabName: process.env.GOOGLE_SHEET_TAB_NAME || 'Documents',
};

const required = [
  ['LINE_CHANNEL_ACCESS_TOKEN', config.line.channelAccessToken],
  ['LINE_CHANNEL_SECRET', config.line.channelSecret],
  ['GEMINI_API_KEY', config.geminiApiKey],
  ['GOOGLE_SHEET_ID', config.googleSheetId],
  ['GOOGLE_OAUTH_CLIENT_ID', config.googleOAuthClientId],
  ['GOOGLE_OAUTH_CLIENT_SECRET', config.googleOAuthClientSecret],
  ['GOOGLE_OAUTH_REFRESH_TOKEN', config.googleOAuthRefreshToken],
];

for (const [name, value] of required) {
  if (!value) {
    console.warn(`[config] Missing ${name} - related features will fail until it is set.`);
  }
}

module.exports = config;
