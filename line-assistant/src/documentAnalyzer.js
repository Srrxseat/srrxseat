const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const config = require('./config');

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const RECORD_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    document_type: {
      type: SchemaType.STRING,
      description: 'e.g. invoice, receipt, bill, contract, ID card, bank slip, other',
    },
    document_date: {
      type: SchemaType.STRING,
      description: 'Date printed on the document, formatted YYYY-MM-DD. Empty string if not found.',
    },
    counterparty: {
      type: SchemaType.STRING,
      description: 'Vendor, company, or person named on the document. Empty string if not found.',
    },
    amount: {
      type: SchemaType.STRING,
      description: 'Total amount on the document as plain text (digits only, no currency symbol). Empty string if none.',
    },
    currency: {
      type: SchemaType.STRING,
      description: 'Currency code or symbol found on the document. Empty string if none.',
    },
    summary: {
      type: SchemaType.STRING,
      description: 'One sentence summary of what this document is.',
    },
    raw_text: {
      type: SchemaType.STRING,
      description: 'All readable text transcribed from the document, best effort.',
    },
  },
  required: ['document_type', 'document_date', 'counterparty', 'amount', 'currency', 'summary', 'raw_text'],
};

async function analyzeDocumentImage(base64Data, mediaType) {
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RECORD_SCHEMA,
    },
  });

  const result = await model.generateContent([
    { inlineData: { mimeType: mediaType, data: base64Data } },
    {
      text: 'This image was shared in a LINE group chat. Treat it as a scanned document and extract the structured fields as best you can from what is visible.',
    },
  ]);

  return JSON.parse(result.response.text());
}

module.exports = { analyzeDocumentImage };
