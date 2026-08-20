const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const config = require('./config');

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const RECORD_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    visitor_name: { type: SchemaType.STRING, description: 'Value of the "Name" field. Empty string if blank.' },
    visit_date: { type: SchemaType.STRING, description: 'Value of the "Date" field, transcribed exactly as written. Empty string if blank.' },
    session_time: { type: SchemaType.STRING, description: 'Which checkbox is marked: "Morning" or "Afternoon". Empty string if neither is marked.' },
    country: { type: SchemaType.STRING, description: 'Value of the "Country" field. Empty string if blank.' },
    gender: { type: SchemaType.STRING, description: 'Value of the "Gender" field. Empty string if blank.' },
    occupation: { type: SchemaType.STRING, description: 'Value of the "Occupation" field. Empty string if blank.' },
    age: { type: SchemaType.STRING, description: 'Value of the "Age" field. Empty string if blank.' },
    social_handle: { type: SchemaType.STRING, description: 'Value of the "FB/IG" field. Empty string if blank.' },
    email: { type: SchemaType.STRING, description: 'Value of the "E-Mail" field. Empty string if blank.' },
    phone: { type: SchemaType.STRING, description: 'Value of the "Phone No./Whatsapp" field. Empty string if blank.' },
    how_heard: {
      type: SchemaType.STRING,
      description: 'Which "How did you hear about us?" checkbox is marked (Facebook fanpage, From friends, Road signs, Google search, Poster, or the handwritten value next to "Other"). Empty string if none is marked.',
    },
    visit_type: { type: SchemaType.STRING, description: 'Which "No. of visit" checkbox is marked: "First time" or "Revisited". Empty string if neither is marked.' },
    experience_text: {
      type: SchemaType.STRING,
      description: 'The handwritten answer to "How Did You Feel?" under Meditation EXP, transcribed as accurately as possible.',
    },
    raw_text: { type: SchemaType.STRING, description: 'All other readable handwritten or printed text on the form not already captured above.' },
  },
  required: [
    'visitor_name', 'visit_date', 'session_time', 'country', 'gender', 'occupation', 'age',
    'social_handle', 'email', 'phone', 'how_heard', 'visit_type', 'experience_text', 'raw_text',
  ],
};

const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const MAX_ATTEMPTS = 3;

// Gemini's free tier allows a limited number of requests per rolling minute
// (Google returned "limit: 5" for this model at time of writing). Pace calls
// client-side so a burst of images doesn't just fire 429s at the API.
const FREE_TIER_REQUESTS_PER_MINUTE = 5;
const RATE_WINDOW_MS = 60_000;
const recentCallTimestamps = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimitSlot() {
  const now = Date.now();
  while (recentCallTimestamps.length > 0 && recentCallTimestamps[0] <= now - RATE_WINDOW_MS) {
    recentCallTimestamps.shift();
  }
  if (recentCallTimestamps.length >= FREE_TIER_REQUESTS_PER_MINUTE) {
    const waitMs = recentCallTimestamps[0] + RATE_WINDOW_MS - Date.now();
    if (waitMs > 0) {
      console.warn(`[documentAnalyzer] pacing for the free-tier rate limit, waiting ${Math.ceil(waitMs / 1000)}s...`);
      await sleep(waitMs);
    }
    return waitForRateLimitSlot();
  }
  recentCallTimestamps.push(Date.now());
}

function retryDelayMs(err, attempt) {
  const retryInfo = err.errorDetails?.find((d) => d['@type']?.includes('RetryInfo'));
  const seconds = retryInfo?.retryDelay ? parseFloat(retryInfo.retryDelay) : null;
  if (seconds) return seconds * 1000;
  return 1000 * 2 ** (attempt - 1);
}

async function analyzeDocumentImage(base64Data, mediaType) {
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RECORD_SCHEMA,
    },
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForRateLimitSlot();
    try {
      const result = await model.generateContent([
        { inlineData: { mimeType: mediaType, data: base64Data } },
        {
          text: 'This image is a handwritten "Pai International Meditation Center" visitor registration and meditation-experience form, shared in a LINE group chat. Read the handwriting carefully and extract the fields below exactly as filled in.',
        },
      ]);
      return JSON.parse(result.response.text());
    } catch (err) {
      const isRetryable = RETRYABLE_STATUS_CODES.has(err.status);
      if (!isRetryable || attempt === MAX_ATTEMPTS) throw err;
      const delay = retryDelayMs(err, attempt);
      console.warn(`[documentAnalyzer] ${err.status} from Gemini, retrying in ${Math.ceil(delay / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await sleep(delay);
    }
  }
}

module.exports = { analyzeDocumentImage };
