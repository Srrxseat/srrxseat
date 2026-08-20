const express = require('express');
const config = require('./config');
const { middleware, lineConfig } = require('./lineClient');
const { handleEvent } = require('./handlers/messageHandler');

const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  res.status(200).end();

  for (const event of req.body.events) {
    handleEvent(event).catch((err) => {
      console.error('[webhook] failed to handle event:', err);
    });
  }
});

app.listen(config.port, () => {
  console.log(`LINE document assistant listening on port ${config.port}`);
});
