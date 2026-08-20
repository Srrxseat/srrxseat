const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const RECORD_TOOL = {
  name: 'record_document',
  description: 'Record structured data extracted from a Pai International Meditation Center visitor registration / meditation-experience form, or flag that the image is not that form.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      is_registration_form: {
        type: 'boolean',
        description: 'True only if this image is a photo of the actual printed "Pai International Meditation Center" registration/meditation-experience paper form itself (with its letterhead and Name/Date/Country/... fields visible), not merely something related to meditation or the center. False for any other kind of image - selfies, screenshots, memes, meals, candid photos, unrelated documents, etc.',
      },
      visitor_name: { type: 'string', description: 'Value of the "Name" field. Empty string if blank.' },
      visit_date: { type: 'string', description: 'Value of the "Date" field, transcribed exactly as written. Empty string if blank.' },
      session_time: { type: 'string', description: 'Which checkbox is marked: "Morning" or "Afternoon". Empty string if neither is marked.' },
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
      visit_type: { type: 'string', description: 'Which "No. of visit" checkbox is marked: "First time" or "Revisited". Empty string if neither is marked.' },
      experience_text: {
        type: 'string',
        description: 'The handwritten answer to "How Did You Feel?" under Meditation EXP, transcribed as accurately as possible.',
      },
      raw_text: {
        type: 'string',
        description: 'Any handwritten or filled-in content on the form not already captured in the fields above. Do NOT include the form\'s static printed template text (the center\'s letterhead/logo caption, section headings like "Meditation EXP.", the "Drawing Your Feeling During Meditation" instruction, the thank-you footer message, or the website URL). Empty string if there is nothing else to capture, or if this isn\'t the form.',
      },
    },
    required: [
      'is_registration_form', 'visitor_name', 'visit_date', 'session_time', 'country', 'gender',
      'occupation', 'age', 'social_handle', 'email', 'phone', 'how_heard', 'visit_type',
      'experience_text', 'raw_text',
    ],
    additionalProperties: false,
  },
};

const PROMPT_TEXT = 'This image was shared in a LINE group chat that also carries unrelated messages and photos - candid photos of people, monks, meals, events, screenshots, memes, etc. Only set is_registration_form to true if the image is a photo of the actual printed "Pai International Meditation Center" registration/meditation-experience paper form itself, not merely something related to meditation or the center. For any other photo, set is_registration_form to false and leave every other field as an empty string - do not guess. If it is the form, read the handwriting carefully and extract the fields below exactly as filled in.';

async function analyzeDocumentImage(base64Data, mediaType) {
  const message = await client.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
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

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

module.exports = { analyzeDocumentImage };
