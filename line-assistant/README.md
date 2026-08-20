# LINE Document Assistant

An AI assistant for a LINE group chat: whenever someone sends a photo of a
Pai International Meditation Center visitor registration / meditation
experience form, it reads the handwriting with Google Gemini (free tier),
saves the original photo to Google Drive, and records the extracted fields
as a new row in a Google Sheet. Plain files sent in the chat are saved to
Drive and logged as well (without OCR).

## How it works

1. LINE sends a webhook event to `POST /webhook` whenever a message is posted
   in a group the bot has joined.
2. For an **image** message: the bot downloads the photo, sends it to Gemini
   (`gemini-flash-latest` by default) to read the handwriting and extract the
   visitor's date, session (morning/afternoon), how they heard about the
   center, name, country, visit type (first time/revisited), gender,
   occupation, FB/IG, email, phone, their "how did you feel" answer, age,
   and any remaining text.
3. The photo is uploaded to a Google Drive folder using a readable filename
   built from the visit date, country, and name (falling back to the LINE
   message ID if extraction fails); the extracted fields plus a link to the
   Drive file are appended as a row in a Google Sheet. The feelings drawing
   itself isn't transcribed — it's preserved as part of the saved photo.
4. For a **file** message (e.g. a PDF someone sends): the file is uploaded to
   the same Drive folder and logged in the sheet without OCR.
5. The bot replies in the chat confirming what was saved.

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

### 2. Google AI Studio (Gemini API key, free tier)

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and sign in
   with a Google account.
2. Click **Create API key** and copy it.
3. The free tier has rate limits (requests per minute/day) that vary by
   model; that's enough for a single group chat. If the group gets very
   busy, Google AI Studio shows how close you are to the limit and where to
   enable paid usage if you ever need it.

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
- `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`)
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

- PDF/file messages are saved but not OCR'd yet; extend
  `src/handlers/messageHandler.js` + `src/documentAnalyzer.js` if text
  extraction from PDFs is needed later.
- The Drive upload happens after the Gemini analysis (not in parallel)
  because the uploaded filename is built from the extracted date/country/name.
- If document scanning starts failing with a 404 on the model name, Google
  has retired that model version — run `node scripts/list-gemini-models.js`
  to see what your API key can currently use and update `GEMINI_MODEL`.
- The Gemini free tier caps requests per minute (Google returned a limit of
  5/minute for the flash model at time of writing). `documentAnalyzer.js`
  paces calls to stay under that limit and retries using Google's own
  suggested delay on 429/500/503, so a burst of photos queues up and gets
  processed a bit slower rather than failing outright. Replies use
  `pushMessage` rather than `replyMessage` for this reason — a reply token
  can expire while a message is queued behind the rate limit. If bursts of
  many forms at once are common, enable billing on the Gemini API key for a
  much higher limit at low cost.
