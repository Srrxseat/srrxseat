# Deploying your own instance

This is the checklist for standing up a **separate, independent instance** of
the assistant — for another meditation center, another organisation, or just a
second Google/LINE account. It's the per-tenant companion to `README.md`:
where the README explains *what each value is and why*, this page is the
ordered list of *what you have to create fresh*, with links back to the README
for the details.

Nothing in the source code is tenant-specific. Every credential and
destination is read from environment variables (`src/config.js`), so a new
instance means new environment variables and a new deployment — **no code
changes at all.**

## What's shared vs. what's per-instance

| | Shared across all instances | Created fresh per instance |
|---|---|---|
| Source code (`src/`, `scripts/`, `Dockerfile`, `render.yaml`) | ✅ same repo | — |
| Form-reading logic, Thai translation, date resolution | ✅ identical | — |
| LINE Official Account + Messaging API channel | — | ✅ |
| Anthropic API key | — | ✅ |
| Google Cloud project + OAuth client | — | ✅ |
| Google refresh token | — | ✅ |
| Drive folder + Google Sheet | — | ✅ |
| Hosting service (Render / Cloud Run) | — | ✅ |

Each instance therefore has its own message quota, its own Claude API bill,
its own Drive storage, and its own data. Two instances never share a sheet,
a folder, or a LINE quota.

## Checklist

Work top to bottom — later steps need values from earlier ones.

### 1. Get the code

Either fork the repository, or just point a new deployment at it. Forking is
only needed if the new operator wants to change the code; to deploy as-is,
read access to this repo is enough.

### 2. LINE Official Account + Messaging API channel

Create a **new** LINE Official Account and a Messaging API channel under it —
see README **Setup → 1. LINE Messaging API channel**. Note the
**Channel access token** and **Channel secret**.

> **Check the plan before you rely on it.** Replies are sent with
> `pushMessage`, which counts against the Official Account's monthly message
> quota. The free plan's allowance (a couple of hundred messages) is spent
> quickly — a single batch of 12 forms is 12 messages — and once it's gone
> LINE returns `429 Too Many Requests` with
> `{"message":"You have reached your monthly limit."}`. Photos still reach
> Drive and rows still reach the Sheet (those are Google APIs, unaffected);
> only the chat replies stop. If the instance will be used for real
> day-to-day logging, put the Official Account on a paid plan at
> [manager.line.biz](https://manager.line.biz/) rather than planning around
> the free quota.

### 3. Anthropic API key

Create a key in the new operator's own Anthropic Console account — README
**Setup → 2**. Usage is billed to whoever owns the key.

### 4. Google Cloud project + OAuth client

README **Setup → 3**. In short: new Cloud project → enable **Drive API** and
**Sheets API** → configure the OAuth consent screen (External) and **add the
operator's own Google address as a test user** → create an OAuth client of
type **Desktop app** → **publish the app** (Google Auth Platform → Audience →
**PUBLISH APP**).

The consent screen must be configured under the same Google account that will
own the Drive folder and Sheet, or the token in step 6 will authenticate as
the wrong account.

> **Don't skip publishing the app.** While the consent screen sits in
> *Testing* status, Google expires every refresh token it issues after **7
> days**. The instance then works flawlessly for a week and dies on day 7
> with `invalid_grant` / `"Token has been expired or revoked."` — nothing
> else changes, which makes it a genuinely confusing failure to diagnose
> after the fact. **Google Auth Platform → Audience → PUBLISH APP** fixes it
> permanently and does not require going through Google's verification
> review; you just accept the "unverified app" warning once, during step 6.

### 5. Drive folder + Google Sheet

Create both in the new operator's Google account, and add the header row to
the sheet tab exactly as listed in README **Setup → 3, step 5**.

Take the **bare IDs**, not the URLs:

```
https://drive.google.com/drive/folders/1jNH...CXd4   ->  1jNH...CXd4
https://docs.google.com/spreadsheets/d/1AG9...ua6M/edit?gid=0   ->  1AG9...ua6M
```

Pasting the whole URL is the single most common setup mistake here — it fails
at runtime as a confusing `404 File not found` / `404 Requested entity was not
found` rather than at startup. `src/config.js` logs the length and shape of
each value on boot so you can spot it in the logs.

### 6. Refresh token

On the operator's **own machine** (not a remote/cloud shell — the OAuth
callback goes to `127.0.0.1`):

```bash
cd line-assistant
npm install
cp .env.example .env      # then fill in the values from steps 2-5
node scripts/get-refresh-token.js
```

Open the printed URL, **log in as the Google account that owns the folder and
sheet**, approve, and paste the printed token into `.env` as
`GOOGLE_OAUTH_REFRESH_TOKEN`. Because the app is published but unverified
(step 4), Google shows a "Google hasn't verified this app" screen here —
choose **Advanced → Go to … (unsafe)** to continue. This is the expected
path for an app only its own owner signs in to.

Then verify it before deploying anywhere:

```bash
node scripts/test-drive-access.js
```

This confirms the token is valid, prints the granted scopes, and looks up the
configured folder and sheet by ID. Getting all four checks green locally
saves a lot of guessing later — if something is wrong, it's wrong here too,
not just on the host.

### 7. Deploy

README **Deploying to a host** covers both options. For Render, the operator
creates a Blueprint from the repo in **their own** Render account;
`render.yaml` declares every secret as `sync: false`, so Render prompts for
each one. Fill them with the values from steps 2-6.

Use a paid plan, not the free tier — README **Why the paid plan** explains
why: free services spin down when idle and any webhook that arrives during
the wake-up window is lost outright.

### 8. Point LINE at the deployment

Set the channel's webhook URL to `https://<the-new-service-host>/webhook`,
turn **Use webhook** on, and click **Verify** — it should return Success.
Also disable the default auto-reply/greeting messages in the LINE Official
Account Manager, otherwise every photo gets a canned reply alongside the real
one.

### 9. Invite the bot and test

Invite the bot into the target group(s), then send one real form photo and
confirm all three destinations:

- the photo appears in the Drive folder,
- a row appears in the sheet,
- a ✅ summary comes back in the chat.

If you set `ALLOWED_GROUP_IDS`, remember the bot silently ignores every group
not on that list — leave it empty while testing.

## Handing an instance over

The operator ends up holding six secrets: the two LINE values, the Anthropic
key, and the three Google OAuth values. Send them through something other
than the LINE group itself, and keep in mind that anyone with the refresh
token can read and write that Google account's Drive and Sheets — it grants
the full `drive` scope, which is required to write into a folder that already
exists. Rotating it means re-running step 6 and updating one environment
variable.
