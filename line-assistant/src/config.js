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
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  googleServiceAccountKeyJson: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON,
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
  googleSheetId: process.env.GOOGLE_SHEET_ID,
  googleSheetTabName: process.env.GOOGLE_SHEET_TAB_NAME || 'Documents',
};

const required = [
  ['LINE_CHANNEL_ACCESS_TOKEN', config.line.channelAccessToken],
  ['LINE_CHANNEL_SECRET', config.line.channelSecret],
  ['ANTHROPIC_API_KEY', config.anthropicApiKey],
  ['GOOGLE_SHEET_ID', config.googleSheetId],
];

for (const [name, value] of required) {
  if (!value) {
    console.warn(`[config] Missing ${name} - related features will fail until it is set.`);
  }
}

module.exports = config;
