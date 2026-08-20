const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const RECORD_TOOL = {
  name: 'record_document',
  description: 'Record structured data extracted from a Pai International Meditation Center visitor registration / meditation-experience form, or flag that the image is not that form.',
  input_schema: {
    type: 'object',
    properties: {
      is_registration_form: {
        type: 'boolean',
        description: 'True only if this image is a photo of the actual printed "Pai International Meditation Center" registration/meditation-experience paper form itself (with its letterhead and Name/Date/Country/... fields visible), not merely something related to meditation or the center. False for any other kind of image - selfies, screenshots, memes, meals, candid photos, unrelated documents, etc.',
      },
      visitor_name: { type: 'string', description: 'Value of the "Name" field. Empty string if blank.' },
      date_raw: {
        type: 'string',
        description: 'The "Date" field copied character for character exactly as the visitor wrote it, e.g. "19/8/26" or "8/19/26" or "19-08-2026". Transcribe only - do NOT reorder the numbers, do NOT decide which one is the day or the month, and do NOT convert or complete it in any way. Empty string if illegible or blank.',
      },
      session_time: { type: 'string', enum: ['Morning', 'Afternoon', ''], description: 'Which checkbox is marked. Empty string if neither is marked.' },
      country: { type: 'string', description: 'Value of the "Country" field. Empty string if blank.' },
      gender: { type: 'string', description: 'Value of the "Gender" field. Empty string if blank.' },
      occupation: { type: 'string', description: 'Value of the "Occupation" field. Empty string if blank.' },
      age: { type: 'string', description: 'Value of the "Age" field. Empty string if blank.' },
      social_handle: { type: 'string', description: 'Value of the "FB/IG" field. Empty string if blank.' },
      email: { type: 'string', description: 'Value of the "E-Mail" field. Empty string if blank.' },
      phone: { type: 'string', description: 'Value of the "Phone No./Whatsapp" field. Empty string if blank.' },
      how_heard: {
        type: 'string',
        description: 'Which "How did you hear about us?" checkbox is marked (Facebook fanpage, From friends, Road signs, Google search, Poster, or the handwritten value next to "Other"). Empty string if none is marked.',
      },
      visit_type: {
        type: 'string',
        enum: ['First time', 'Revisited', ''],
        description: 'Which "No. of visit" checkbox is marked. Only ever one of these three exact values - never anything else, and never a description of the drawing at the bottom of the form. Empty string if neither is marked.',
      },
      experience_text: {
        type: 'string',
        description: 'The handwritten answer to "How Did You Feel?" under Meditation EXP, transcribed as accurately as possible, in its original language (usually English).',
      },
      experience_text_th: {
        type: 'string',
        description: 'A Thai translation of experience_text. Empty string if experience_text is empty.',
      },
      raw_text: {
        type: 'string',
        description: 'Any handwritten or filled-in *words* on the form not already captured in the fields above. Do NOT include the form\'s static printed template text (the center\'s letterhead/logo caption, section headings like "Meditation EXP.", the "Drawing Your Feeling During Meditation" instruction, the thank-you footer message, or the website URL). Do NOT describe the drawing at the bottom of the form or anything else pictorial - the saved photo is the record of the drawing, so a written description of it is not wanted anywhere in this record. Empty string if there is nothing else to capture, or if this isn\'t the form.',
      },
    },
    required: [
      'is_registration_form', 'visitor_name', 'date_raw', 'session_time',
      'country', 'gender', 'occupation', 'age', 'social_handle', 'email', 'phone', 'how_heard',
      'visit_type', 'experience_text', 'experience_text_th', 'raw_text',
    ],
    additionalProperties: false,
  },
};

const PROMPT_TEXT = [
  'This image was shared in a LINE group chat that also carries unrelated messages and photos - candid photos of people, monks, meals, events, screenshots, memes, etc. Only set is_registration_form to true if the image is a photo of the actual printed "Pai International Meditation Center" registration/meditation-experience paper form itself, not merely something related to meditation or the center. For any other photo, set is_registration_form to false and leave every other field as an empty string - do not guess.',
  'If it is the form, read the handwriting carefully and extract the fields below exactly as filled in. Each field holds only the value of its own labeled box on the form, nothing from elsewhere on the page.',
  'Checkboxes need care because they are small: "How did you hear about us?" and "No. of visit" are each a row of them near the bottom of the personal-information block, and the mark may be a tick, a cross, a filled box, or a circle around the label. Report the label of the box that is marked. Plenty of visitors skip these rows entirely, and an empty field is the correct, useful answer for a row with no mark on it - never infer what the visitor "probably" meant from their name, country, or anything they wrote elsewhere on the form.',
  'For the date: copy the "Date" box exactly as written into date_raw and nothing more. Visitors write dates in their own country\'s convention, so do not try to work out which number is the day, do not reorder anything, and do not convert or complete the date - that is handled elsewhere and your guess would break it. Just transcribe what is on the paper.',
].join('\n\n');

const pad = (n) => String(n).padStart(2, '0');

// The center is in Pai; LINE timestamps are UTC. Shifting by the offset and
// then reading UTC getters gives the local calendar date without pulling in a
// timezone library.
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

function thaiDateParts(timestampMs) {
  const local = new Date(timestampMs + THAI_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

// The handwritten date is the least reliable thing on the form. The form is
// printed Day/Month/Year, but visitors write it in their own country's
// convention - an American writes "8/19/26" for 19 August - so which number is
// the day genuinely cannot be decided from the digits' positions alone. Asking
// the model to make that call produced a different answer per form (three USA
// visitors' forms all came out as 8 January).
//
// So the model only transcribes the field verbatim, and the decision happens
// here, where it can be reasoned about once and tested:
//   - the year is the last number (D/M/Y and M/D/Y agree on that)
//   - of the remaining two, anything above 12 must be the day
//   - if both are <= 12 the date is genuinely ambiguous, so prefer the reading
//     whose month matches the month the photo was sent
// The message timestamp also supplies the year whenever the written one is
// missing or implausible: visitors fill the form on the day they visit and
// staff photograph it the same day.
function resolveVisitDate(raw, timestampMs) {
  const ref = thaiDateParts(timestampMs);
  const refDate = `${ref.year}/${pad(ref.month)}/${pad(ref.day)}`;
  const numbers = (raw || '').match(/\d+/g);

  if (!numbers || numbers.length < 2) {
    console.log(`[documentAnalyzer] unreadable date ${JSON.stringify(raw)}, using the date LINE received the photo (${refDate})`);
    return refDate;
  }

  // Year: the last number when three were written, otherwise not written at all.
  let year = null;
  let dayMonth = numbers;
  if (numbers.length >= 3) {
    dayMonth = numbers.slice(0, 2);
    year = parseInt(numbers[2], 10);
    if (year < 100) year += 2000;
  }
  if (year === null || Math.abs(year - ref.year) > 1) {
    if (year !== null) {
      console.log(`[documentAnalyzer] implausible year in ${JSON.stringify(raw)}, using ${ref.year} from the message timestamp`);
    }
    year = ref.year;
  }

  const [first, second] = dayMonth.map((n) => parseInt(n, 10));
  let day;
  let month;
  if (first > 12 && second <= 12) {
    [day, month] = [first, second];        // 19/8 - written Day/Month
  } else if (second > 12 && first <= 12) {
    [day, month] = [second, first];        // 8/19 - written Month/Day
  } else if (first <= 12 && second <= 12) {
    // Ambiguous: "8/1" is either 8 January or 1 August. Prefer whichever
    // reading falls in the month the photo arrived in.
    [day, month] = second === ref.month ? [first, second] : [second, first];
    console.log(`[documentAnalyzer] ambiguous date ${JSON.stringify(raw)}, read as ${year}/${pad(month)}/${pad(day)}`);
  } else {
    console.log(`[documentAnalyzer] nonsensical date ${JSON.stringify(raw)}, using the date LINE received the photo (${refDate})`);
    return refDate;
  }

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    console.log(`[documentAnalyzer] out-of-range date ${JSON.stringify(raw)}, using the date LINE received the photo (${refDate})`);
    return refDate;
  }

  return `${year}/${pad(month)}/${pad(day)}`;
}

// The form has no fixed vocabulary for Gender, so visitors write "F", "Female",
// "male", etc. Fold the obvious abbreviations together so the column is
// filterable, but leave anything else exactly as written rather than forcing it
// into a bucket it may not belong in.
function normalizeGender(value) {
  const raw = (value || '').trim();
  if (/^(f|female|woman|w)$/i.test(raw)) return 'Female';
  if (/^(m|male|man)$/i.test(raw)) return 'Male';
  return raw;
}

// A `strict: true` schema would enforce these enums for us, but the full form
// schema is too large for the API's strict-mode compiler ("Schema is too
// complex for compilation"), so the enum is only a hint to the model and the
// guarantee has to happen here. Anything outside the allowed set - e.g. the
// drawing description Claude once wrote into visit_type - becomes blank
// rather than landing in the wrong sheet column.
function coerceEnum(value, allowed) {
  const match = allowed.find((option) => option.toLowerCase() === (value || '').trim().toLowerCase());
  return match || '';
}

async function analyzeDocumentImage(base64Data, mediaType, timestampMs) {
  const message = await client.messages.create({
    model: config.anthropicModel,
    // Generous headroom: a long English answer plus its Thai translation is a
    // lot of tokens (Thai runs several tokens per character), and at the old
    // 1024 cap the tool input was being truncated mid-record, silently
    // dropping whichever fields came last.
    max_tokens: 8000,
    tools: [RECORD_TOOL],
    tool_choice: { type: 'tool', name: 'record_document' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: PROMPT_TEXT },
        ],
      },
    ],
  });

  if (message.stop_reason === 'max_tokens') {
    console.warn('[documentAnalyzer] response hit max_tokens - record may be incomplete');
  }

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  if (!toolUse) return null;

  const { date_raw, ...rest } = toolUse.input;
  return {
    ...rest,
    visit_date: resolveVisitDate(date_raw, timestampMs),
    session_time: coerceEnum(rest.session_time, ['Morning', 'Afternoon']),
    visit_type: coerceEnum(rest.visit_type, ['First time', 'Revisited']),
    gender: normalizeGender(rest.gender),
  };
}

module.exports = { analyzeDocumentImage };
