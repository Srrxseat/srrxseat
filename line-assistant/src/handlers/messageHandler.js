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

// Claude has occasionally leaked its own tool-call tag syntax (e.g.
// "</antml...><parameter name=\"...\">") into a field's text value. Strip any
// angle-bracket tag fragments before this ever reaches the sheet or the chat.
function stripLeakedTags(value) {
  return (value || '').toString().replace(/<[^>]*>/g, '').trim();
}

function cleanExtracted(extracted) {
  if (!extracted) return extracted;
  const cleaned = { ...extracted };
  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === 'string') cleaned[key] = stripLeakedTags(value);
  }
  return cleaned;
}

function sanitizeForFilename(value) {
  return (value || '')
    .toString()
    .trim()
    .replace(/[/.]/g, '-')
    .replace(/[^a-zA-Z0-9ก-๙\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

// Name first: Drive's grid view truncates long filenames to roughly the first
// dozen characters, so leading with the date made every tile read
// "2026-08-..." and the visitor - the thing you actually search for - was the
// part cut off.
function buildFilename(extracted, messageId) {
  const shortId = messageId.slice(-8);
  if (!extracted) return `unrecognized_${shortId}.jpg`;

  const parts = [extracted.visitor_name, extracted.visit_date, extracted.country]
    .map(sanitizeForFilename)
    .filter(Boolean);

  return `${[...parts, shortId].join('_')}.jpg`;
}

// Joining on a separator only between the parts that actually have a value -
// the old template always emitted its separators, so a form with no visit type
// ticked ended with a dangling "— Afternoon ·".
function buildReply(extracted) {
  const heading = [
    `✅ ${extracted.visitor_name || 'unnamed visitor'}`,
    extracted.country,
    extracted.visit_date,
    extracted.session_time,
    extracted.visit_type,
  ].filter(Boolean).join(' · ');

  return [
    heading,
    extracted.experience_text && `\n📝 ${extracted.experience_text}`,
    extracted.experience_text_th && `\n🇹🇭 ${extracted.experience_text_th}`,
  ].filter(Boolean).join('\n');
}

async function handleImageMessage(event) {
  const { source, message } = event;
  const buffer = await streamToBuffer(await blobClient.getMessageContent(message.id));
  const senderName = await getSenderName(source);

  const extracted = cleanExtracted(await analyzeDocumentImage(buffer.toString('base64'), 'image/jpeg', event.timestamp).catch((err) => {
    console.error('[documentAnalyzer] failed:', err.message);
    return null;
  }));

  // Don't just trust the model's is_registration_form flag on its own - a real
  // form always has at least a name or a written experience, so treat a
  // "yes" with both of those blank as a misclassification too.
  const looksLikeForm = extracted && extracted.is_registration_form
    && (extracted.visitor_name || extracted.experience_text);

  if (extracted && !looksLikeForm) {
    console.log(`[messageHandler] skipping image ${message.id} - not a registration form`);
    return;
  }

  const drive = await uploadDocument(buffer, buildFilename(extracted, message.id), 'image/jpeg');

  await appendRow([
    extracted ? extracted.visit_date : '',
    extracted ? extracted.session_time : '',
    extracted ? extracted.how_heard : '',
    extracted ? extracted.visitor_name : '',
    extracted ? extracted.country : '',
    extracted ? extracted.visit_type : '',
    extracted ? extracted.gender : '',
    extracted ? extracted.occupation : '',
    extracted ? extracted.social_handle : '',
    extracted ? extracted.email : '',
    extracted ? extracted.phone : '',
    extracted ? extracted.experience_text : '',
    extracted ? extracted.experience_text_th : '',
    extracted ? extracted.age : '',
    drive.webViewLink,
    senderName,
    extracted ? extracted.raw_text : '(automatic extraction failed, photo saved as-is)',
    new Date(event.timestamp).toISOString(),
  ]);

  const replyText = extracted
    ? buildReply(extracted)
    : 'Saved the photo, but could not read the form automatically. Please check it manually in the sheet.';

  await client.pushMessage({
    to: getChatId(source),
    messages: [{ type: 'text', text: replyText }],
  });
}

async function handleFileMessage(event) {
  const { source, message } = event;
  const buffer = await streamToBuffer(await blobClient.getMessageContent(message.id));
  const senderName = await getSenderName(source);

  const drive = await uploadDocument(buffer, message.fileName, 'application/octet-stream');

  await appendRow([
    '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    drive.webViewLink,
    senderName,
    `(file, not a scanned form) ${message.fileName}`,
    new Date(event.timestamp).toISOString(),
  ]);

  await client.pushMessage({
    to: getChatId(source),
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
