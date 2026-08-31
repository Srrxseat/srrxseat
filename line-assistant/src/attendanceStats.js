// Everything that turns raw drop-in log rows into counts: who a row belongs to,
// which visit it is for that person, and the month totals. Kept free of Google
// and LINE so the arithmetic can be exercised on its own.

// The front desk writes the same visitor down differently on different days -
// "Mia" one afternoon and "Mia Keidar" the next, "Emma berry" / "Emma Berry" /
// "EMMA" across three. Counting the raw strings reports far more visitors than
// actually came, so rows are grouped onto one person first.
//
// The rule is deliberately narrow: one name's words must be a subset of the
// other's, whole words only, and the countries must agree. Whole words matter -
// a prefix rule would fold "Dana Peer" into "Daniela Sipka".
function nameTokens(name) {
  return new Set(
    (name || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function isSubset(small, large) {
  for (const token of small) if (!large.has(token)) return false;
  return true;
}

// Nationalities are written as either the country or the adjective, and both
// spellings of the same place have to land in one bucket for the country count
// - and for the name matching above - to mean anything.
const COUNTRY_ALIASES = {
  israeli: 'Israel', israel: 'Israel',
  uk: 'UK', england: 'UK', english: 'UK', british: 'UK', britain: 'UK', scotland: 'UK', wales: 'UK',
  american: 'USA', usa: 'USA', us: 'USA', america: 'USA',
  australian: 'Australia', australia: 'Australia', aussie: 'Australia',
  chinese: 'China', china: 'China',
  turkish: 'Turkey', turkey: 'Turkey',
  austrian: 'Austria', austria: 'Austria',
  belgian: 'Belgium', belgium: 'Belgium',
  german: 'Germany', germany: 'Germany', deutschland: 'Germany',
  french: 'France', france: 'France',
  italian: 'Italy', italy: 'Italy',
  spanish: 'Spain', spain: 'Spain',
  dutch: 'Netherlands', netherlands: 'Netherlands', holland: 'Netherlands',
  canadian: 'Canada', canada: 'Canada',
  japanese: 'Japan', japan: 'Japan',
  korean: 'Korea', korea: 'Korea',
  thai: 'Thailand', thailand: 'Thailand',
  indian: 'India', india: 'India',
  russian: 'Russia', russia: 'Russia',
  brazilian: 'Brazil', brazil: 'Brazil',
  mexican: 'Mexico', mexico: 'Mexico',
  swiss: 'Switzerland', switzerland: 'Switzerland',
  swedish: 'Sweden', sweden: 'Sweden',
  norwegian: 'Norway', norway: 'Norway',
  danish: 'Denmark', denmark: 'Denmark',
  finnish: 'Finland', finland: 'Finland',
  polish: 'Poland', poland: 'Poland',
  portuguese: 'Portugal', portugal: 'Portugal',
  irish: 'Ireland', ireland: 'Ireland',
  argentinian: 'Argentina', argentine: 'Argentina', argentina: 'Argentina',
  vietnamese: 'Vietnam', vietnam: 'Vietnam',
  singaporean: 'Singapore', singapore: 'Singapore',
  malaysian: 'Malaysia', malaysia: 'Malaysia',
  indonesian: 'Indonesia', indonesia: 'Indonesia',
  filipino: 'Philippines', philippines: 'Philippines',
  taiwanese: 'Taiwan', taiwan: 'Taiwan',
  kiwi: 'New Zealand', 'new zealand': 'New Zealand',
};

function normalizeCountry(value) {
  const raw = (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return '';
  if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw];
  return raw.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// The fuller spelling is the better label for the person - "Emma Berry" reads
// better in a report than "EMMA" - so a group adopts the variant with the most
// words, and among equals the one written with capitals kept as-is.
// ... and where two variants have the same words, the better-capitalised one
// ("Emma Berry" over "Emma berry" over "EMMA"). Names are only ever compared
// case-insensitively, so this affects nothing but how the person reads in the
// sheet and the monthly report.
function capitalisationScore(name) {
  return (name || '').split(/\s+/).filter((word) => /^\p{Lu}\p{Ll}/u.test(word)).length;
}

function betterLabel(current, candidate) {
  if (!current) return candidate;
  const a = nameTokens(current).size;
  const b = nameTokens(candidate).size;
  if (b !== a) return b > a ? candidate : current;
  const scoreA = capitalisationScore(current);
  const scoreB = capitalisationScore(candidate);
  if (scoreB !== scoreA) return scoreB > scoreA ? candidate : current;
  return candidate.length > current.length ? candidate : current;
}

// Rows arrive in whatever order the pages were photographed - an older page can
// be sent after a newer one - so "which visit is this" is decided by the visit
// date, never by position in the sheet.
function comparableDate(row) {
  return (row.date || '').trim();
}

function groupPeople(rows) {
  const groups = [];
  for (const row of rows) {
    const tokens = nameTokens(row.name);
    const country = normalizeCountry(row.nationality);
    if (!tokens.size) {
      groups.push({ label: row.name || '(unnamed)', tokens, country, rows: [row] });
      continue;
    }
    const match = groups.find((group) => group.tokens.size
      && (group.country === country || !group.country || !country)
      && (isSubset(tokens, group.tokens) || isSubset(group.tokens, tokens)));
    if (match) {
      match.rows.push(row);
      if (isSubset(match.tokens, tokens)) match.tokens = tokens;
      match.label = betterLabel(match.label, row.name);
      if (!match.country) match.country = country;
    } else {
      groups.push({ label: row.name || '(unnamed)', tokens, country, rows: [row] });
    }
  }
  return groups;
}

// For each row: the canonical person, which visit of theirs it is in date
// order, and their total so far. Returned keyed by the row's index in the input
// so the caller can write the values back beside the right rows.
function deriveVisitColumns(rows) {
  const derived = new Array(rows.length);
  for (const group of groupPeople(rows)) {
    const ordered = [...group.rows].sort((a, b) => comparableDate(a).localeCompare(comparableDate(b)) || a.index - b.index);
    ordered.forEach((row, position) => {
      derived[row.index] = { person: group.label, visitNumber: position + 1, totalVisits: ordered.length };
    });
  }
  return derived;
}

function monthKey(date) {
  const match = (date || '').match(/^(\d{4})\/(\d{2})/);
  return match ? `${match[1]}/${match[2]}` : '';
}

function summarizeMonth(rows, month) {
  const inMonth = rows.filter((row) => monthKey(row.date) === month);
  const groups = groupPeople(inMonth);

  const countries = new Map();
  for (const group of groups) {
    const country = group.country || '(unknown)';
    countries.set(country, (countries.get(country) || 0) + 1);
  }

  const days = new Set(inMonth.map((row) => row.date).filter(Boolean));
  const returning = groups.filter((group) => group.rows.length > 1);

  return {
    month,
    attendances: inMonth.length,
    people: groups.length,
    countries: [...countries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    days: days.size,
    returning: returning
      .map((group) => ({ name: group.label, visits: group.rows.length }))
      .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)),
  };
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatMonth(month) {
  const [year, m] = (month || '').split('/');
  const name = THAI_MONTHS[parseInt(m, 10) - 1];
  return name ? `${name} ${year}` : month;
}

function formatMonthlyReport(summary) {
  if (!summary.attendances) {
    return `📊 รายงานประจำเดือน ${formatMonth(summary.month)}\n\nยังไม่มีบันทึกผู้เข้าร่วมในเดือนนี้`;
  }

  const lines = [
    `📊 รายงานประจำเดือน ${formatMonth(summary.month)}`,
    '',
    `🧘 ผู้เข้าปฏิบัติธรรม ${summary.people} คน จาก ${summary.countries.length} ประเทศ`,
    `🔁 เข้าร่วมรวม ${summary.attendances} ครั้ง ใน ${summary.days} วัน`,
    '',
    `🌏 ${summary.countries.map(([country, n]) => `${country} ${n}`).join(' · ')}`,
  ];

  if (summary.returning.length) {
    lines.push('', `🙏 ผู้กลับมาซ้ำ ${summary.returning.length} คน`);
    lines.push(summary.returning.map((person) => `${person.name} (${person.visits})`).join(' · '));
  }

  return lines.join('\n');
}

module.exports = {
  normalizeCountry,
  groupPeople,
  deriveVisitColumns,
  monthKey,
  summarizeMonth,
  formatMonth,
  formatMonthlyReport,
};
