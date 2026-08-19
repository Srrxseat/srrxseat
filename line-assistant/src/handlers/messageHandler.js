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
    extracted ? extracted.visitor_name : '',
    extracted ? extracted.visit_date : '',
    extracted ? extracted.session_time : '',
    extracted ? extracted.country : '',
    extracted ? extracted.gender : '',
    extracted ? extracted.occupation : '',
    extracted ? extracted.age : '',
    extracted ? extracted.social_handle : '',
    extracted ? extracted.email : '',
    extracted ? extracted.phone : '',
    extracted ? extracted.how_heard : '',
    extracted ? extracted.visit_type : '',
    extracted ? extracted.experience_text : '',
    extracted ? extracted.drawing_description : '',
    drive.webViewLink,
    message.id,
    extracted ? extracted.raw_text : '(automatic extraction failed, photo saved as-is)',
  ]);

  const replyText = extracted
    ? `Saved ✅ ${extracted.visitor_name || 'unnamed visitor'} (${extracted.country || '?'}) — ${extracted.session_time || 'session'} · ${extracted.visit_type || ''}`
    : 'Saved the photo, but could not read the form automatically. Please check it manually in the sheet.';

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
    '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    drive.webViewLink,
    message.id,
    `(file, not a scanned form) ${message.fileName}`,
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
