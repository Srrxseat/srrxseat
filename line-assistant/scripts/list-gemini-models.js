require('dotenv').config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Set GEMINI_API_KEY in .env first.');
    process.exit(1);
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('Models that support generateContent (usable by this app):\n');
  for (const model of data.models) {
    if (model.supportedGenerationMethods?.includes('generateContent')) {
      console.log(model.name.replace('models/', ''));
    }
  }
}

main();
