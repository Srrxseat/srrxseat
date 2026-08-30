// The center is in Pai; LINE timestamps and the server clock are UTC. Shifting
// by the offset and then reading UTC getters gives the local calendar date
// without pulling in a timezone library.
const THAI_OFFSET_MS = 7 * 60 * 60 * 1000;

function thaiDateParts(timestampMs) {
  const local = new Date(timestampMs + THAI_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

// Day 0 of the next month is the last day of this one, which also handles
// February and leap years without a table.
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

module.exports = { thaiDateParts, daysInMonth };
