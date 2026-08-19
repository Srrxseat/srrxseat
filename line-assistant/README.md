# LINE Document Assistant

An AI assistant for a LINE group chat: whenever someone sends a photo of a
document (receipt, invoice, bill, etc.), it scans the image with Claude,
saves the original photo to Google Drive, and records the extracted data
as a new row in a Google Sheet. Plain files sent in the chat are saved to
Drive and logged as well (without OCR).

## How it works

1. LINE sends a webhook event to `POST /webhook` whenever a message is posted
   in a group the bot has joined.
2. For an **image** message: the bot downloads the photo, sends it to Claude
   (`claude-sonnet-5` by default) to extract document type, date,
   counterparty, amount, currency, a summary, and the raw transcribed text.
3. The photo is uploaded to a Google Drive folder; the extracted fields plus
   a link to the Drive file are appended as a row in a Google Sheet.
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

### 2. Google Cloud (Drive + Sheets)

1. Create a Google Cloud project, enable the **Google Drive API** and
   **Google Sheets API**.
2. Create a **service account**, then create and download a JSON key for it.
3. Create (or pick) a Drive folder for uploaded documents and a Google Sheet
   for the log. Share both with the service account's email address
   (found in the JSON key as `client_email`) as **Editor**.
4. Add a header row to the sheet tab (default tab name `Documents`):

   ```
   Timestamp | Source Type | Chat ID | Sender | Document Type | Document Date | Counterparty | Amount | Currency | Summary | Drive Link | Message ID | Raw Text
   ```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`
- `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`)
- `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` — paste the full service-account JSON on
  one line, **or** set `GOOGLE_APPLICATION_CREDENTIALS` to a mounted key
  file path instead.
- `GOOGLE_DRIVE_FOLDER_ID` — the ID from the folder's URL.
- `GOOGLE_SHEET_ID` — the ID from the spreadsheet's URL.
- `GOOGLE_SHEET_TAB_NAME` — defaults to `Documents`.
- `ALLOWED_GROUP_IDS` — optional comma-separated allowlist.

### 4. Run

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
- The Drive upload and Claude analysis run in parallel per message to keep
  the reply latency low.
