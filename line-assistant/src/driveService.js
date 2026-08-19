const { google } = require('googleapis');
const { Readable } = require('stream');
const { getAuth } = require('./googleAuth');
const config = require('./config');

async function uploadDocument(buffer, filename, mimeType) {
  const drive = google.drive({ version: 'v3', auth: getAuth() });
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: config.googleDriveFolderId ? [config.googleDriveFolderId] : undefined,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, webViewLink',
  });
  return res.data;
}

module.exports = { uploadDocument };
