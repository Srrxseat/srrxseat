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
   Claude (`claude-haiku-4-5-20251001` by default), which first decides
   whether the image is actually a Pai International Meditation Center
   registration form at all. This matters in a busy group chat that also
   carries unrelated photos and messages: if it's confidently **not** a form
   (a selfie, screenshot, meme, etc.), the bot does nothing at all — no
   upload, no sheet row, no reply, so it doesn't clutter either. If it is,
   Claude reads the handwriting and extracts the visitor's date, session
   (morning/afternoon), how they heard about the center, name, country,
   visit type (first time/revisited), gender, occupation, FB/IG, email,
   phone, their "how did you feel" answer, and age.
3. The photo is uploaded to a Google Drive folder using a readable filename
   built from the visit date, country, and name (falling back to the LINE
   message ID if extraction fails); the extracted fields plus a link to the
   Drive file are appended as a row in a Google Sheet. The feelings drawing
   itself isn't transcribed — it's preserved as part of the saved photo. If
   Claude errors out entirely (rate limit, outage) rather than confidently
   saying "not a form", the bot still saves the photo and a mostly-blank row
   for manual review, since it can't rule out a real form having failed to
   read — better to over-save than silently lose a real submission.
4. For a **file** message (e.g. a PDF someone sends): the file is uploaded to
   the same Drive folder and logged in the sheet without OCR (there's no
   not-a-form check for files yet — see Notes below).
5. The bot replies in the chat confirming what was saved (image messages
   that turned out not to be a form get no reply at all).

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
   at this app's volume (photos scanned per day) the cost is a few dollars a
   month at most on `claude-haiku-4-5-20251001`.

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
   Date | Time | how did you find us | Name | Country | No. of visited | Gender | occupation | FB/IG | E-mail | whatsapp | Meditation experience | Age | Drive Link | Sender | Raw Text
   ```

   This matches the column layout the center already uses for its manual
   visitor log, with `Age`, `Drive Link` (photo of the original form),
   `Sender` (the LINE user who sent the photo), and `Raw Text` (catch-all
   for anything else legible on the form) appended at the end. `Monk 1` /
   `Monk 2` / `Facilitator` from the manual log are intentionally **not**
   included — the bot has no way to read who taught a session from the
   visitor's own form, so those stay a manual note if you still want them.

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
and point the LINE webhook URL at the tunnel's HTTPS URL. For production,
deploy to any Node.js host (Render, Railway, Fly.io, a VM, etc.) and use its
public HTTPS URL as the webhook.

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
