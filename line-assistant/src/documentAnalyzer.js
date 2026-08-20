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
      date_day: { type: 'string', description: 'The day portion of the "Date" field (leftmost number, form is written Day/Month/Year), digits only, e.g. "17". Empty string if illegible or blank.' },
      date_month: { type: 'string', description: 'The month portion of the "Date" field (middle number), digits only, e.g. "8". Empty string if illegible or blank.' },
      date_year: { type: 'string', description: 'The year portion of the "Date" field (rightmost number), digits only exactly as written - 2 or 4 digits, e.g. "26". Empty string if illegible or blank.' },
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
        description: 'Any handwritten or filled-in content on the form not already captured in the fields above. Do NOT include the form\'s static printed template text (the center\'s letterhead/logo caption, section headings like "Meditation EXP.", the "Drawing Your Feeling During Meditation" instruction, the thank-you footer message, or the website URL). Empty string if there is nothing else to capture, or if this isn\'t the form.',
      },
    },
    required: [
      'is_registration_form', 'visitor_name', 'date_day', 'date_month', 'date_year', 'session_time',
      'country', 'gender', 'occupation', 'age', 'social_handle', 'email', 'phone', 'how_heard',
      'visit_type', 'experience_text', 'experience_text_th', 'raw_text',
    ],
    additionalProperties: false,
  },
};

const PROMPT_TEXT = [
  'This image was shared in a LINE group chat that also carries unrelated messages and photos - candid photos of people, monks, meals, events, screenshots, memes, etc. Only set is_registration_form to true if the image is a photo of the actual printed "Pai International Meditation Center" registration/meditation-experience paper form itself, not merely something related to meditation or the center. For any other photo, set is_registration_form to false and leave every other field as an empty string - do not guess.',
  'If it is the form, read the handwriting carefully and extract the fields below exactly as filled in. Each field holds only the value of its own labeled box on the form, nothing from elsewhere on the page.',
  'Checkboxes need particular care - they are small and the mark may be a tick, a cross, a filled box, or a circle around the label. "How did you hear about us?" and "No. of visit" are each a row of checkboxes near the bottom of the personal-information block, and the visitor almost always marks one in each row, so look closely before concluding a row is unmarked. Report the label of the marked box. Only leave the field empty if you genuinely cannot see a mark.',
  'For the date: transcribe the digits in each position of the "Date" box separately and literally. Do not convert, reorder, or reason about the calendar. If the year digits are unclear, leave date_year empty rather than guessing - a correct blank is far more useful here than a wrong year.',
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

// The handwritten date is the least reliable thing on the form: the year is a
// scrawled 2 digits the model has misread as far off as 2019, and sometimes it
// hands back only two of the three numbers, which used to produce half-dates
// like "8/19" that the sheet can't sort on.
//
// Visitors fill the form on the day they visit and the photo reaches the LINE
// group the same day, so the message timestamp is a better source for the year
// than the handwriting is. Trust the model for day and month (validated), and
// let the timestamp supply or overrule an implausible year.
function resolveVisitDate(day, month, year, timestampMs) {
  const ref = thaiDateParts(timestampMs);

  let d = parseInt(day, 10);
  let m = parseInt(month, 10);

  // The form reads Day/Month, but the model occasionally returns them swapped.
  // A month above 12 is unambiguous evidence of that.
  if (Number.isInteger(d) && Number.isInteger(m) && m > 12 && d <= 12) {
    [d, m] = [m, d];
  }

  const dayOk = Number.isInteger(d) && d >= 1 && d <= 31;
  const monthOk = Number.isInteger(m) && m >= 1 && m <= 12;

  if (!dayOk || !monthOk) {
    console.log(`[documentAnalyzer] unreadable date (day=${day} month=${month} year=${year}), using the date LINE received the photo`);
    return `${ref.year}/${pad(ref.month)}/${pad(ref.day)}`;
  }

  let y = parseInt(year, 10);
  if (Number.isInteger(y) && y < 100) y += 2000;
  const yearOk = Number.isInteger(y) && Math.abs(y - ref.year) <= 1;
  if (!yearOk) {
    console.log(`[documentAnalyzer] implausible year "${year}", using ${ref.year} from the message timestamp`);
  }

  return `${yearOk ? y : ref.year}/${pad(m)}/${pad(d)}`;
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

  const { date_day, date_month, date_year, ...rest } = toolUse.input;
  return {
    ...rest,
    visit_date: resolveVisitDate(date_day, date_month, date_year, timestampMs),
    session_time: coerceEnum(rest.session_time, ['Morning', 'Afternoon']),
    visit_type: coerceEnum(rest.visit_type, ['First time', 'Revisited']),
    gender: normalizeGender(rest.gender),
  };
}

module.exports = { analyzeDocumentImage };
