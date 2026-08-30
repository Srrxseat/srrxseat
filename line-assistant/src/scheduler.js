const { client } = require('./lineClient');
const { buildMonthlyReport } = require('./reportService');
const { thaiDateParts, daysInMonth } = require('./thaiTime');
const config = require('./config');

// cron has no "last day of the month", and the length of that month varies, so
// the check runs on a plain interval and asks whether today happens to be it.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Which month a report has already been sent for, so the repeated checks inside
// the sending hour don't send it again. This lives in memory: a redeploy during
// that one hour would send a second copy, which is the accepted cost of not
// keeping state anywhere for it.
let lastSentMonth = null;

function isLastDayOfMonth({ year, month, day }) {
  return day === daysInMonth(year, month);
}

async function sendMonthlyReport(month) {
  const report = await buildMonthlyReport(month);
  if (!report) {
    console.log(`[scheduler] no drop-in data for ${month}, nothing to report`);
    return;
  }
  for (const groupId of config.reportGroupIds) {
    try {
      await client.pushMessage({ to: groupId, messages: [{ type: 'text', text: report }] });
      console.log(`[scheduler] month-end report for ${month} sent to ${groupId}`);
    } catch (err) {
      console.error(`[scheduler] failed to send the ${month} report to ${groupId}:`, err.message);
    }
  }
}

async function checkOnce(now = Date.now()) {
  const parts = thaiDateParts(now);
  const month = `${parts.year}/${String(parts.month).padStart(2, '0')}`;
  if (!isLastDayOfMonth(parts)) return;
  if (parts.hour !== config.reportHour) return;
  if (lastSentMonth === month) return;

  lastSentMonth = month;
  await sendMonthlyReport(month).catch((err) => {
    console.error('[scheduler] month-end report failed:', err.message);
  });
}

function start() {
  if (!config.reportGroupIds.length) {
    console.log('[scheduler] REPORT_GROUP_IDS is not set - the month-end report is off.');
    return null;
  }
  console.log(`[scheduler] month-end report armed for ${config.reportHour}:00 Thailand time, to ${config.reportGroupIds.length} group(s)`);
  const timer = setInterval(() => { checkOnce().catch(() => {}); }, CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { start, checkOnce, sendMonthlyReport, isLastDayOfMonth };
