# LINE Document Assistant

An AI assistant for a LINE group chat: whenever someone sends a photo of a
Pai International Meditation Center visitor registration / meditation
experience form, it reads the handwriting with Claude, saves the original
photo to Google Drive, and records the extracted fields as a new row in a
Google Sheet. Plain files sent in the chat are saved to Drive and logged as
well (without OCR).

## How it works

1. LINE sends a webhook event to `POST /webhook` whenever a message is posted
   in a group the bot has joined.
2. For an **image** message: the bot downloads the photo and sends it to
   Claude (`claude-opus-5` by default — reading small handwritten checkboxes
   and scrawled dates is the hard part of this job, and every misread costs
   manual correction), which first decides
   whether the image is actually a Pai International Meditation Center
   registration form at all. This matters in a busy group chat that also
   carries unrelated photos and messages: if it's confidently **not** a form
   (a selfie, screenshot, meme, etc.), the bot does nothing at all — no
   upload, no sheet row, no reply, so it doesn't clutter either. If it is,
   Claude reads the handwriting and extracts the visitor's date (as three
   separate day/month/year digits, reassembled deterministically in code
   rather than trusting the model to do date arithmetic — see
   "How the visit date is decided" below), session
   (morning/afternoon), how they heard about the center, name, country,
   visit type (first time/revisited), gender, occupation, FB/IG, email,
   phone, their "how did you feel" answer (plus an auto-generated Thai
   translation of it), and age.
3. The photo is uploaded to a Google Drive folder using a readable filename
   built from the visit date, country, and name — date first, so sorting by
   filename groups the forms by visit day (falling back to the LINE message ID
   if extraction fails); the extracted fields plus a link to the
   Drive file are appended as a row in a Google Sheet. The feelings drawing
   itself isn't transcribed — it's preserved as part of the saved photo. If
   Claude errors out entirely (rate limit, outage) rather than confidently
   saying "not a form", the bot still saves the photo and a mostly-blank row
   for manual review, since it can't rule out a real form having failed to
   read — better to over-save than silently lose a real submission.
4. For a **file** message (e.g. a PDF someone sends): the file is uploaded to
   the same Drive folder and logged in the sheet without OCR (there's no
   not-a-form check for files yet — see Notes below).
5. The bot replies in the chat confirming what was saved — the visitor's name,
   country, date and session, followed by their "how did you feel" answer and
   its Thai translation, so the group can read the experience without opening
   the sheet (image messages that turned out not to be a form get no reply at
   all).

## Setup

### 1. LINE Messaging API channel

1. Create a channel in the [LINE Developers Console](https://developers.line.biz/console/)
   under a Messaging API provider.
2. Under the channel's "Messaging API" tab:
   - Issue a **Channel access token** (long-lived).
   - Copy the **Channel secret** from the "Basic settings" tab.
   - Set the **Webhook URL** to `https://<your-host>/webhook` and enable
     "Use webhook".
   - Turn off "Auto-reply messages" and "Greeting messages" so the bot's
     replies aren't drowned out.
3. Add the bot as a friend and invite it into the target LINE group.
4. (Optional) To restrict the bot to specific groups, get each group's ID
   from the webhook event logs and set `ALLOWED_GROUP_IDS`.

### 2. Anthropic Console (Claude API key)

1. Go to [console.anthropic.com](https://console.anthropic.com/) and sign in
   or create an account.
2. Go to **API Keys → Create Key**, name it, and copy it — it's shown once.
3. Under **Settings → Billing**, add a payment method. There's no free tier;
   at this app's volume (a few dozen photos a day) the cost is still on the
   order of tens of dollars a month on the default `claude-opus-5`. Set
   `ANTHROPIC_MODEL=claude-sonnet-5` to roughly halve that if you'd rather
   trade some handwriting accuracy for cost.

### 3. Google Cloud (Drive + Sheets)

Personal Google accounts (including paid Google One storage plans) don't give
service accounts any storage quota, so a service account can't upload files
into your Drive — only Google Workspace accounts can work around that with
Shared Drives. Instead, this app authenticates as **your own Google account**
via OAuth, so uploaded files count against your own Google One storage like
normal.

1. Create a Google Cloud project, enable the **Google Drive API** and
   **Google Sheets API**.
2. Go to **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth
   client ID**. If prompted, configure the OAuth consent screen first (choose
   **External**, fill in an app name and your email, and add yourself as a
   test user — no verification needed for personal use). For the client type
   choose **Desktop app**, give it a name, and create it. Copy the **Client
   ID** and **Client secret**.
3. Create (or pick) a Drive folder for uploaded documents and a Google Sheet
   for the log, under the Google account you want to authenticate as. No
   sharing step needed — it's your own account.
4. Add a header row to the sheet tab (default tab name `Documents`):

   ```
   Date | Time | how did you find us | Name | Country | No. of visited | Gender | occupation | FB/IG | E-mail | whatsapp | Meditation experience | Translation | Age | Drive Link | Sender | Raw Text | Received At
   ```

   This matches the column layout the center already uses for its manual
   visitor log, with `Translation` (a Thai translation of the "Meditation
   experience" text, auto-generated), `Age`, `Drive Link` (photo of the
   original form), `Sender` (the LINE user who sent the photo), `Raw Text`
   (catch-all for anything else legible on the form), and `Received At` (the
   exact time LINE received the message, ISO 8601 — useful for spotting
   when a photo was actually processed, though rows are no longer forced
   into strict send order — see below) appended at the end. `Monk 1` /
   `Monk 2` / `Facilitator` from the manual log are intentionally **not**
   included — the bot has no way to read who taught a session from the
   visitor's own form, so those stay a manual note if you still want them.

   Images are processed concurrently rather than queued one-at-a-time, so
   rows land in whatever order each photo's analysis finishes, not
   necessarily the order the photos were sent — this was a deliberate
   trade-off for speed. If you need to see them in the order photos actually
   arrived, sort the sheet by `Received At`.

   The Drive folder itself has no send-order guarantee either — it's
   whatever sort the Drive UI is set to (often alphabetical by filename,
   which does *not* match send order). Switch the sort dropdown to "Last
   modified" to see photos in upload order.

### 4. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`
- `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`)
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` — from step 3 above.
- `GOOGLE_DRIVE_FOLDER_ID` — the ID from the folder's URL.
- `GOOGLE_SHEET_ID` — only the ID segment of the spreadsheet's URL, e.g. for
  `https://docs.google.com/spreadsheets/d/1AbCdEf.../edit?gid=0` the value is
  just `1AbCdEf...` — drop everything from `/edit` onward.
- `GOOGLE_SHEET_TAB_NAME` — defaults to `Documents`.
- `ALLOWED_GROUP_IDS` — optional comma-separated allowlist.

With the OAuth client ID/secret in `.env`, get the last value by running:

```bash
node scripts/get-refresh-token.js
```

Open the URL it prints, log in with the Google account that owns the Drive
folder and Sheet, and approve access. The script prints a refresh token —
paste it into `.env` as `GOOGLE_OAUTH_REFRESH_TOKEN`. This is a one-time step
(the token doesn't expire from normal use).

### 5. Run

```bash
cd line-assistant
npm install
npm start
```

For local testing, expose port 3000 with a tunnel (e.g. `ngrok http 3000`)
and point the LINE webhook URL at the tunnel's HTTPS URL.

## Deploying to a host

Running with `npm start` on a laptop means the bot stops receiving photos the
moment the machine sleeps or the terminal closes. For real use it needs a host
that stays up.

**The one requirement that rules hosts out:** the webhook answers LINE with
`200` immediately and *then* does the slow work (download the photo, call
Claude, upload to Drive, append to the sheet) — 10–30 seconds after the
response has already been sent. See `src/server.js`. That's necessary because
LINE won't wait that long for a response, but it means the host has to keep the
process running and CPU allocated after the response. Hosts that stop the
process when the response ends (PHP-style shared hosting, Cloud Run with its
default CPU throttling) will cut the work off half-done — the photo gets a
reply but never reaches the sheet.

### Option A — Google Cloud Run

Good if you already have the Google Cloud project from the Drive/Sheets setup:
the perpetual free tier is denominated in millions of requests, and this bot
handles a few dozen a day. `Dockerfile` and `.dockerignore` are in
`line-assistant/`.

```bash
cd line-assistant
cp env.cloudrun.example.yaml env.cloudrun.yaml   # fill in, it's gitignored

gcloud run deploy line-doc-assistant \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --memory 512Mi \
  --max-instances 3 \
  --env-vars-file env.cloudrun.yaml
```

Cloud Run requires billing to be enabled on the project — unlike the Drive and
Sheets APIs, which are free and need no card. The free tier still applies, but
overage bills the card rather than stopping the service, so **set a budget
alert before deploying**: Cloud Console → Billing → Budgets & alerts → Create
budget, scoped to this project, with a threshold you'd want to hear about.
`--max-instances 3` is the second guard: it caps how many containers can run at
once, so a runaway loop or a flood of traffic can't quietly scale up a bill.

`--no-cpu-throttling` is **not optional** — it's what keeps the CPU allocated
after the response so the background work finishes. Without it the bot appears
to work (LINE gets its reply) while silently dropping rows.
`--allow-unauthenticated` is required because LINE calls the endpoint without
GCP credentials; the webhook is still protected by LINE's signature
verification (`middleware(lineConfig)` in `src/server.js`).
`asia-southeast1` is Singapore, the closest region to Thailand.

Set the LINE webhook to `https://<the URL gcloud prints>/webhook`.

Cost with CPU always allocated is billed per instance-second while an instance
is alive, not per request, so it depends on how the photo batches cluster
through the day — expect somewhere between free and a few dollars a month.
Check the actual numbers on the [Cloud Run pricing
page](https://cloud.google.com/run/pricing) rather than trusting an estimate
here.

### Option B — Render

`render.yaml` in the repo root is a [Render](https://render.com) Blueprint that
describes the whole service. To use it: **Render dashboard → New → Blueprint →
pick this repo**. Render reads the file, creates the service, and then prompts
for each secret (they're marked `sync: false` so they are never committed).
Fill in the same values as your local `.env`, including
`GOOGLE_OAUTH_REFRESH_TOKEN` — the refresh token works fine from a server, so
there's no need to re-run `get-refresh-token.js`.

When the first deploy finishes, Render gives the service a public HTTPS URL.
Set the LINE webhook to `https://<that-url>/webhook` and press **Verify** in
the LINE console. `GET /health` is wired up as Render's health check.

#### Why the paid plan

The Blueprint asks for the **Starter** plan, not **Free**, and that's the one
real decision here. Free web services spin down after 15 minutes idle and take
30–60 seconds to wake up, and **a LINE webhook that arrives during that window
is lost** — LINE doesn't queue it for later. In practice that means the first
photo of every batch disappears, which is the one failure this whole system
exists to prevent.

If you want to try Free anyway, keep the service awake by pinging
`/health` every 10 minutes from an external scheduler (e.g. a free
cron-job.org job). Free instances get 750 hours a month and a month is 744
hours, so one always-awake service just fits — but it's fragile: if the pinger
stops, photos start vanishing silently. Starter is the boring, reliable choice.

Any other Node host works the same way — Railway, Fly.io, a small VM. The only
requirements are a public HTTPS URL, the environment variables, and
`npm start`.

## How the visit date is decided

The handwritten `Date` box is the least reliable thing on the form. The form is
printed **Day/Month/Year**, but visitors write dates in their own country's
convention — an American writes `8/19/26` for 19 August — so *which number is
the day cannot be decided from position alone*. Asking Claude to make that call
gave a different answer per form (three USA visitors' forms all came out as
8 January).

So Claude only transcribes the box verbatim into `date_raw`, and the decision is
made in code (`resolveVisitDate` in `src/documentAnalyzer.js`) where it can be
reasoned about once and unit-tested:

- **The year is the last number.** `D/M/Y` and `M/D/Y` agree on that, so it's
  unambiguous. It's used only if it's within a year of the date LINE received
  the photo; otherwise the message timestamp's year is used. Visitors fill the
  form on the day they visit and staff photograph it the same day, so the
  timestamp is the more trustworthy source.
- **Of the first two numbers, anything above 12 must be the day.** That resolves
  `19/8` and `8/19` to the same date without knowing the visitor's nationality.
- **If both are 12 or under** the date is genuinely ambiguous (`8/1` is either
  8 January or 1 August), so the reading whose month matches the month the photo
  arrived in wins, and the choice is logged.
- **If the box is illegible or nonsensical**, the date falls back to the date
  LINE received the photo, and a line is logged saying so.

Those last two are inferences, not readings — if forms are ever photographed in
a batch weeks after the fact, the affected rows will lean on the upload date.
The console log names every row where that happened, and the Drive photo is
always there to check against.

## Notes / next steps

- PDF/file messages are saved but not OCR'd yet, and every file message is
  saved unconditionally (no not-a-form check like images get, since nothing
  reads the file's content). Extend `src/handlers/messageHandler.js` +
  `src/documentAnalyzer.js` if a busy group also shares unrelated files and
  those need filtering too, or if PDF text extraction is needed later.
- A busy group where most images aren't the registration form still spends
  one Claude call per image just to classify it. There's no free-tier daily
  cap to worry about here (billing is required from the start), but it's
  worth keeping in mind for cost if the group is very chatty with photos.
- The Drive upload happens after the Claude analysis (not in parallel)
  because the uploaded filename is built from the extracted date/country/name.
- The Anthropic SDK retries transient errors (429/5xx/connection issues)
  automatically with backoff (`max_retries`, default 2), so
  `documentAnalyzer.js` doesn't need its own retry loop. Replies use
  `pushMessage` rather than `replyMessage` regardless, since a reply token
  can still expire if a request is retried or just runs long.
- If Claude retires a model version, `messages.create` returns a 404 naming
  the model — swap `ANTHROPIC_MODEL` for a current one (see the model table
  in Anthropic's docs).
