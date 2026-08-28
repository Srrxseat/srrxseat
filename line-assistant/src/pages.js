const config = require('./config');

// Google won't move an OAuth app out of "Testing" status - and refresh tokens
// issued by an app in Testing expire after 7 days - without a working homepage
// URL and privacy policy URL on the consent screen. Rather than depending on a
// separate site existing, the service hosts both itself: it already has a
// public HTTPS URL, so `/` and `/privacy` are the two links the consent screen
// needs. See README "Setup - 3. Google Cloud".

function escapeHtml(value) {
  return (value || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 3rem 1.25rem 5rem; max-width: 42rem;
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; }
  .lede { opacity: .7; margin-top: 0; }
  ul { padding-left: 1.25rem; }
  li { margin: .35rem 0; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid rgba(128,128,128,.35); opacity: .7; font-size: .9rem; }
  a { color: inherit; }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
<footer><a href="/">Home</a> &middot; <a href="/privacy">Privacy policy</a></footer>
</body>
</html>`;
}

// The operator's own support address. Left out of the pages entirely when
// unset, rather than falling back to someone else's address.
function contactBlock() {
  const email = config.supportEmail;
  if (!email) {
    return `<p>For questions about this deployment or the data it holds, contact
    whoever operates it — the same organisation that runs the LINE account the
    assistant replies from.</p>`;
  }
  return `<p>For questions about this deployment or the data it holds, or to ask
  for records to be corrected or deleted, contact
  <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>.</p>`;
}

const home = page('LINE Document Assistant', `
<h1>LINE Document Assistant</h1>
<p class="lede">A private assistant for one organisation's LINE group chats.</p>

<p>When someone photographs a visitor registration form and posts it in a LINE
group this assistant has been invited to, it reads the handwriting, files the
original photo in the operator's Google Drive, records the details as a row in
the operator's Google Sheet, and replies in the chat with what it read.</p>

<h2>Who it's for</h2>
<p>This is not a public service and has no sign-up. It runs for a single
organisation, responds only in the LINE groups it has been invited to, and
stores everything in that organisation's own Google account.</p>

${contactBlock()}
`);

const privacy = page('Privacy policy — LINE Document Assistant', `
<h1>Privacy policy</h1>
<p class="lede">How the LINE Document Assistant handles the information it receives.</p>

<h2>What it receives</h2>
<p>The assistant only ever sees messages posted in LINE group chats it has been
invited to. For those chats it receives:</p>
<ul>
  <li>photos and files posted in the chat;</li>
  <li>the LINE display name of whoever posted them;</li>
  <li>the time LINE delivered the message.</li>
</ul>
<p>It does not read a member's other chats, contacts, or profile beyond the
display name shown in the group, and it does not message anyone outside the
groups it has been added to.</p>

<h2>What it does with them</h2>
<ul>
  <li>Photographed forms are sent to Anthropic's Claude API to transcribe the
      handwriting into structured fields.</li>
  <li>The original photo is uploaded to a Google Drive folder belonging to the
      organisation operating the assistant.</li>
  <li>The transcribed fields, the sender's display name, and a link to the
      photo are appended as a row to that organisation's Google Sheet.</li>
  <li>A summary of what was read is posted back into the same LINE group.</li>
</ul>
<p>Because registration forms are filled in by visitors, the information handled
this way can include a visitor's name, country, age, gender, occupation,
contact details, and what they wrote about their experience.</p>

<h2>Where it is stored</h2>
<p>Only in the operating organisation's own Google Drive and Google Sheet. The
assistant keeps no database and no copies of its own: images pass through
memory while a message is being processed and are not written to its server.
Retention, access, and deletion are therefore governed by that organisation's
Google account, under its own control.</p>

<h2>Who else sees it</h2>
<p>Three service providers process this data on the operator's behalf, each
only to perform the step above: <strong>LINE</strong> (message delivery),
<strong>Anthropic</strong> (handwriting transcription), and <strong>Google</strong>
(Drive and Sheets storage). Nothing is sold, shared for advertising, or passed
to anyone else.</p>

<h2>Google account access</h2>
<p>The assistant acts on the operator's own Google account through OAuth, using
Drive and Sheets access granted by that account holder. It uses that access
solely to upload form photos to the folder and append rows to the sheet the
operator configured. The account holder can revoke it at any time from
<a href="https://myaccount.google.com/permissions">Google Account
permissions</a>, which immediately stops all Drive and Sheets access.</p>

<h2>Your choices</h2>
<p>Anyone in a group can stop the assistant from processing their material by
not posting it there, and removing the assistant from a group stops it
entirely for that group.</p>

${contactBlock()}
`);

module.exports = { home, privacy };
