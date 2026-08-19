const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const RECORD_TOOL = {
  name: 'record_document',
  description: 'Record structured data extracted from a scanned document image shared in a chat.',
  input_schema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        description: 'e.g. invoice, receipt, bill, contract, ID card, bank slip, other',
      },
      document_date: {
        type: 'string',
        description: 'Date printed on the document, formatted YYYY-MM-DD. Empty string if not found.',
      },
      counterparty: {
        type: 'string',
        description: 'Vendor, company, or person named on the document. Empty string if not found.',
      },
      amount: {
        type: 'string',
        description: 'Total amount on the document as plain text (digits only, no currency symbol). Empty string if none.',
      },
      currency: {
        type: 'string',
        description: 'Currency code or symbol found on the document. Empty string if none.',
      },
      summary: {
        type: 'string',
        description: 'One sentence summary of what this document is.',
      },
      raw_text: {
        type: 'string',
        description: 'All readable text transcribed from the document, best effort.',
      },
    },
    required: ['document_type', 'document_date', 'counterparty', 'amount', 'currency', 'summary', 'raw_text'],
  },
};

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
          {
            type: 'text',
            text: 'This image was shared in a LINE group chat. Treat it as a scanned document and extract the structured fields as best you can from what is visible.',
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  return toolUse ? toolUse.input : null;
}

module.exports = { analyzeDocumentImage };
