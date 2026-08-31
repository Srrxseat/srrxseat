const { client, blobClient } = require('../lineClient');
const { uploadDocument } = require('../driveService');
const { appendRow, appendRows, readRows } = require('../sheetsService');
const { analyzeDocumentImage } = require('../documentAnalyzer');
const { readLog, refreshDerivedColumns, buildMonthlyReport, latestMonth } = require('../reportService');
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
  if (Array.isArray(extracted)) return extracted.map(cleanExtracted);
  if (!extracted || typeof extracted !== 'object') return extracted;
  const cleaned = { ...extracted };
  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === 'string') cleaned[key] = stripLeakedTags(value);
    else if (value && typeof value === 'object') cleaned[key] = cleanExtracted(value);
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

// Date first, so sorting by filename groups the forms by visit day. Drive's
// grid view truncates the tile captions, so use the list view (or the search
// box) when you need to pick out a particular visitor by name.
function buildFilename(extracted, messageId) {
  const shortId = messageId.slice(-8);
  if (!extracted) return `unrecognized_${shortId}.jpg`;

  const parts = [extracted.visit_date, extracted.country, extracted.visitor_name]
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

// The attendance sheet lives on one piece of paper that the front desk keeps
// adding to, so the same page is photographed again on a later day with the
// earlier rows still on it. Keying a row by the day, session and name lets a
// re-read skip what is already recorded instead of doubling it.
function attendanceKey(date, session, name) {
  return [date, session, name]
    .map((value) => (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

function buildLogFilename(rows, messageId) {
  const date = rows.length ? sanitizeForFilename(rows[0].visit_date) : '';
  return `${[date, 'drop-in-log', messageId.slice(-8)].filter(Boolean).join('_')}.jpg`;
}

// Listing the names back is what makes a misread catchable - the staff can see
// at a glance whether a name came out wrong - so the reply groups them by day
// rather than just reporting a count.
function buildLogReply(rows, addedRows, duplicates) {
  const counts = [`${rows.length} row${rows.length === 1 ? '' : 's'} read`];
  if (addedRows.length !== rows.length) counts.push(`${addedRows.length} new`);
  if (duplicates) counts.push(`${duplicates} already recorded`);

  const header = `✅ Drop-in log — ${counts.join(', ')}`;
  if (!addedRows.length) return header;

  const byDate = new Map();
  for (const row of addedRows) {
    const date = row.visit_date || 'no date';
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row.name || '(unnamed)');
  }

  const sections = [...byDate].map(([date, names]) => `📅 ${date} (${names.length})\n${names.join(' · ')}`);
  const full = [header, ...sections].join('\n\n');

  // LINE caps a text message at 5000 characters; a page with a lot of rows can
  // approach that, and a truncated-looking reply is worse than a short one.
  return full.length <= 4500 ? full : header;
}

async function handleAttendanceLog(event, extracted, buffer, senderName) {
  const { source, message } = event;
  const rows = Array.isArray(extracted.rows) ? extracted.rows : [];

  const drive = await uploadDocument(buffer, buildLogFilename(rows, message.id), 'image/jpeg');

  const recorded = new Set(
    (await readRows(config.googleSheetLogTabName)).map((row) => attendanceKey(row[0], row[1], row[2])),
  );


  const receivedAt = new Date(event.timestamp).toISOString();
  const addedRows = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = attendanceKey(row.visit_date, row.session_time, row.name);
    if (recorded.has(key)) {
      duplicates += 1;
      continue;
    }
    recorded.add(key);
    addedRows.push(row);
  }

  await appendRows(config.googleSheetLogTabName, addedRows.map((row) => [
    row.visit_date,
    row.session_time,
    row.name,
    row.nationality,
    row.visit_type,
    row.monk,
    row.facilitator,
    drive.webViewLink,
    senderName,
    receivedAt,
  ]));

  console.log(`[messageHandler] attendance log ${message.id}: ${rows.length} read, ${addedRows.length} added, ${duplicates} already recorded`);

  // Re-read rather than reusing what was read above: the append has happened
  // since, and the derived columns have to cover the new rows too. Both the
  // visit numbering and the report come from the same fresh snapshot.
  const messages = [{ type: 'text', text: buildLogReply(rows, addedRows, duplicates) }];
  try {
    const records = await readLog();
    await refreshDerivedColumns(records);
    const month = latestMonth(addedRows.map((row) => ({ date: row.visit_date }))) || latestMonth(records);
    const report = await buildMonthlyReport(month, records);
    if (report) messages.push({ type: 'text', text: report });
  } catch (err) {
    // The rows are already saved; a failure to summarise them shouldn't lose
    // the confirmation that they were.
    console.error('[messageHandler] could not build the monthly summary:', err.message);
  }

  const chatId = getChatId(source);
  try {
    await client.pushMessage({ to: chatId, messages });
    console.log(`[messageHandler] log reply sent to ${source.type} ${chatId}`);
  } catch (err) {
    console.error(`[messageHandler] failed to send log reply to ${source.type} ${chatId}:`, err.message);
    throw err;
  }
}

async function handleImageMessage(event) {
  const { source, message } = event;
  const buffer = await streamToBuffer(await blobClient.getMessageContent(message.id));
  const senderName = await getSenderName(source);

  const extracted = cleanExtracted(await analyzeDocumentImage(buffer.toString('base64'), 'image/jpeg', event.timestamp).catch((err) => {
    console.error('[documentAnalyzer] failed:', err.message);
    return null;
  }));

  if (extracted && extracted.document_type === 'attendance_log') {
    await handleAttendanceLog(event, extracted, buffer, senderName);
    return;
  }

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

  const chatId = getChatId(source);
  try {
    await client.pushMessage({
      to: chatId,
      messages: [{ type: 'text', text: replyText }],
    });
    console.log(`[messageHandler] reply sent to ${source.type} ${chatId} for ${extracted?.visitor_name || 'unknown'}`);
  } catch (err) {
    console.error(`[messageHandler] failed to send reply to ${source.type} ${chatId}:`, err.message);
    throw err;
  }
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

  const chatId = getChatId(source);
  try {
    await client.pushMessage({
      to: chatId,
      messages: [{ type: 'text', text: `Saved file ✅ ${message.fileName}` }],
    });
    console.log(`[messageHandler] file reply sent to ${source.type} ${chatId}`);
  } catch (err) {
    console.error(`[messageHandler] failed to send file reply to ${source.type} ${chatId}:`, err.message);
    throw err;
  }
}

// Typing "report" (or "รายงาน") in the chat prints the same summary the
// month-end job sends, so it can be checked on demand - and previewed in a test
// group before the scheduled send is switched on. An optional month argument
// ("report 2026/08") looks back at an earlier one.
const REPORT_COMMAND = /^\s*(?:report|รายงาน)(?:\s+(\d{4})[/-](\d{1,2}))?\s*$/i;

async function handleTextMessage(event) {
  const match = REPORT_COMMAND.exec(event.message.text || '');
  if (!match) return;

  const month = match[1] ? `${match[1]}/${String(parseInt(match[2], 10)).padStart(2, '0')}` : null;
  const chatId = getChatId(event.source);
  const report = await buildMonthlyReport(month);

  await client.pushMessage({
    to: chatId,
    messages: [{ type: 'text', text: report || 'ยังไม่มีบันทึกผู้เข้าร่วมในชีท' }],
  });
  console.log(`[messageHandler] report for ${month || 'the latest month'} sent to ${event.source.type} ${chatId}`);
}

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (!isAllowed(event.source)) return;

  if (event.message.type === 'image') {
    await handleImageMessage(event);
  } else if (event.message.type === 'file') {
    await handleFileMessage(event);
  } else if (event.message.type === 'text') {
    await handleTextMessage(event);
  }
}

module.exports = { handleEvent };
