const express = require('express');
const config = require('./config');
const { middleware, lineConfig } = require('./lineClient');
const { handleEvent } = require('./handlers/messageHandler');

const app = express();

// LINE can deliver photos sent close together as separate webhook requests.
// Express handles those concurrently by default, so whichever one finishes
// analysis first would get written to the sheet first - not necessarily in
// the order they were actually sent. Funnel every event through one queue,
// shared across requests, so they're always handled one at a time in the
// order they arrived.
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.catch(() => {});
  return result;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/webhook', middleware(lineConfig), async (req, res) => {
  res.status(200).end();

  for (const event of req.body.events) {
    enqueue(() => handleEvent(event).catch((err) => {
      console.error('[webhook] failed to handle event:', err);
    }));
  }
});

app.listen(config.port, () => {
  console.log(`LINE document assistant listening on port ${config.port}`);
});
