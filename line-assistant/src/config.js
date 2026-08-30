require('dotenv').config();

// Some hosts' env var editors (Render included) can silently carry a copy-pasted
// trailing newline or space into a secret's value. That's invisible in the UI but
// turns a folder ID or refresh token into a different string than the one that
// works locally, so trim every secret/id pulled from the environment.
function trimmedEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : value;
}

function splitIds(value) {
  return (value || '').split(',').map((id) => id.trim()).filter(Boolean);
}

const config = {
  port: process.env.PORT || 3000,
  line: {
    channelAccessToken: trimmedEnv('LINE_CHANNEL_ACCESS_TOKEN'),
    channelSecret: trimmedEnv('LINE_CHANNEL_SECRET'),
  },
  allowedGroupIds: splitIds(process.env.ALLOWED_GROUP_IDS),
  anthropicApiKey: trimmedEnv('ANTHROPIC_API_KEY'),
  // Reading small handwritten checkboxes and scrawled dates is the hard part of
  // this job, and misreads cost manual correction, so default to the strongest
  // model. Set ANTHROPIC_MODEL=claude-sonnet-5 to trade accuracy back for cost.
  anthropicModel: trimmedEnv('ANTHROPIC_MODEL') || 'claude-opus-5',
  googleOAuthClientId: trimmedEnv('GOOGLE_OAUTH_CLIENT_ID'),
  googleOAuthClientSecret: trimmedEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
  googleOAuthRefreshToken: trimmedEnv('GOOGLE_OAUTH_REFRESH_TOKEN'),
  googleDriveFolderId: trimmedEnv('GOOGLE_DRIVE_FOLDER_ID'),
  googleSheetId: trimmedEnv('GOOGLE_SHEET_ID'),
  googleSheetTabName: trimmedEnv('GOOGLE_SHEET_TAB_NAME') || 'Documents',
  // Separate tab for the drop-in attendance sheet: one photo of it produces
  // many rows with a different shape from the per-visitor form, so the two
  // don't share a table.
  googleSheetLogTabName: trimmedEnv('GOOGLE_SHEET_LOG_TAB_NAME') || 'Drop-in Log',
  // Shown as the contact address on the public / and /privacy pages. Optional -
  // those pages fall back to generic wording rather than another deployment's
  // address, so an unset value is never wrong, just less helpful.
  supportEmail: trimmedEnv('SUPPORT_EMAIL'),
  // Groups the month-end report is pushed to. There is no way to discover which
  // groups the bot is in, so this has to be listed explicitly; it falls back to
  // ALLOWED_GROUP_IDS when that is already the same list.
  reportGroupIds: splitIds(process.env.REPORT_GROUP_IDS || process.env.ALLOWED_GROUP_IDS),
  // Hour of the last day of the month, Thailand time, to send that report.
  reportHour: Number.isInteger(parseInt(trimmedEnv('REPORT_HOUR'), 10))
    ? parseInt(trimmedEnv('REPORT_HOUR'), 10)
    : 20,
};

const required = [
  ['LINE_CHANNEL_ACCESS_TOKEN', config.line.channelAccessToken],
  ['LINE_CHANNEL_SECRET', config.line.channelSecret],
  ['ANTHROPIC_API_KEY', config.anthropicApiKey],
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

// Never log the values themselves - just enough shape (length, first/last
// char) to spot a copy-paste mismatch against another environment (e.g. a
// stray trailing newline that survived Render's env var UI) without leaking
// the secret into logs.
console.log(
  '[config] env var fingerprint:',
  required
    .map(([name, value]) => `${name}=${value ? `len:${value.length} [${value[0]}..${value[value.length - 1]}]` : 'MISSING'}`)
    .join(' | '),
);
console.log(`[config] GOOGLE_DRIVE_FOLDER_ID=${config.googleDriveFolderId ? `len:${config.googleDriveFolderId.length} [${config.googleDriveFolderId}]` : 'MISSING'}`);

module.exports = config;
