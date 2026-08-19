const { client, blobClient } = require('../lineClient');
const { uploadDocument } = require('../driveService');
const { appendRow } = require('../sheetsService');
const { analyzeDocumentImage } = require('../documentAnalyzer');
const config = require('../config');

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function getChatId(source) {
  if (source.type === 'group') return source.groupId;
  if (source.type === 'room') return source.roomId;
  return source.userId;
}

async function getSenderName(source) {
  try {
    if (source.type === 'group') {
      const profile = await client.getGroupMemberProfile(source.groupId, source.userId);
      return profile.displayName;
    }
    if (source.type === 'room') {
      const profile = await client.getRoomMemberProfile(source.roomId, source.userId);
      return profile.displayName;
    }
    const profile = await client.getProfile(source.userId);
    return profile.displayName;
  } catch (err) {
    return source.userId || 'unknown';
  }
}

function isAllowed(source) {
  if (config.allowedGroupIds.length === 0) return true;
  const chatId = getChatId(source);
  return config.allowedGroupIds.includes(chatId);
}

async function handleImageMessage(event) {
  const { source, replyToken, message } = event;
  const buffer = await streamToBuffer(await blobClient.getMessageContent(message.id));
  const timestamp = new Date(event.timestamp).toISOString();
  const senderName = await getSenderName(source);

  const [drive, extracted] = await Promise.all([
    uploadDocument(buffer, `${timestamp}_${message.id}.jpg`, 'image/jpeg'),
    analyzeDocumentImage(buffer.toString('base64'), 'image/jpeg').catch((err) => {
      console.error('[documentAnalyzer] failed:', err.message);
      return null;
    }),
  ]);

  await appendRow([
    timestamp,
    source.type,
    getChatId(source),
    senderName,
    extracted ? extracted.document_type : 'unknown',
    extracted ? extracted.document_date : '',
    extracted ? extracted.counterparty : '',
    extracted ? extracted.amount : '',
    extracted ? extracted.currency : '',
    extracted ? extracted.summary : '(automatic extraction failed, photo saved as-is)',
    drive.webViewLink,
    message.id,
    extracted ? extracted.raw_text : '',
  ]);

  const replyText = extracted
    ? `Saved ✅\n${extracted.document_type} - ${extracted.summary}${extracted.amount ? `\nAmount: ${extracted.amount} ${extracted.currency}` : ''}`
    : 'Saved the photo, but could not read the document automatically. Please check it manually in the sheet.';

  await client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text: replyText }],
  });
}

async function handleFileMessage(event) {
  const { source, replyToken, message } = event;
  const buffer = await streamToBuffer(await blobClient.getMessageContent(message.id));
  const timestamp = new Date(event.timestamp).toISOString();
  const senderName = await getSenderName(source);

  const drive = await uploadDocument(buffer, message.fileName, 'application/octet-stream');

  await appendRow([
    timestamp,
    source.type,
    getChatId(source),
    senderName,
    'file',
    '',
    '',
    '',
    '',
    message.fileName,
    drive.webViewLink,
    message.id,
    '',
  ]);

  await client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text: `Saved file ✅ ${message.fileName}` }],
  });
}

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (!isAllowed(event.source)) return;

  if (event.message.type === 'image') {
    await handleImageMessage(event);
  } else if (event.message.type === 'file') {
    await handleFileMessage(event);
  }
}

module.exports = { handleEvent };
