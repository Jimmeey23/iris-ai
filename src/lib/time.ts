/**
 * One clock for the whole AI pipeline: Asia/Kolkata.
 *
 * The agent prompt resolves "today/yesterday" in IST, so every date the code
 * computes around it (session lookups, match windows) must use the same
 * calendar — otherwise a report filed at 1am IST searches the wrong day.
 */

const IST = "Asia/Kolkata";

/** YYYY-MM-DD for "today" in IST, optionally offset by whole days. */
export function istDate(offsetDays = 0, instant: Date = new Date()): string {
  const shifted = new Date(instant.getTime() + offsetDays * 86400000);
  return shifted.toLocaleDateString("en-CA", { timeZone: IST }); // en-CA → YYYY-MM-DD
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Map a free-text "when" phrase (as stored in `occurredAt`) to the calendar
 * date in IST it refers to — or undefined when the phrase is not day-specific
 * ("earlier this week", "ongoing") so callers can treat it as unknown.
 */
export function resolveWhenToDate(
  phrase: string | undefined,
  instant: Date = new Date(),
): string | undefined {
  const p = (phrase ?? "").toLowerCase();
  if (!p || /not specified|^n\/a$|unknown|ongoing|recurring|this week|last week|last month|last few|for \d+ (days|weeks)|since /.test(p)) {
    return undefined;
  }
  if (/just now|right now|happening now|as we speak|currently|at the moment|today|this morning|this afternoon|this evening|tonight/.test(p)) {
    return istDate(0, instant);
  }
  if (/yesterday|last night/.test(p)) return istDate(-1, instant);

  // Explicit ISO date written into the phrase.
  const iso = p.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  // "3 Sept", "3rd September" / "Sept 3", "September 3rd" — resolve to the year
  // that puts the date nearest to now (timetable windows are ± a few days).
  const dayMonth = p.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})/);
  const monthDay = p.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const raw = dayMonth ?? monthDay;
  if (raw) {
    const day = dayMonth ? Number(raw[1]) : Number(raw[2]);
    const monthKey = (dayMonth ? raw[2] : raw[1]).slice(0, 4).toLowerCase();
    const monthNum = MONTHS[monthKey === "sept" ? "sept" : monthKey.slice(0, 3)];
    if (day >= 1 && day <= 31 && monthNum) {
      const year = nearestYear(instant, monthNum, day);
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function nearestYear(instant: Date, month: number, day: number): number {
  const istYear = Number(istDate(0, instant).slice(0, 4));
  let best = istYear;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const year of [istYear - 1, istYear, istYear + 1]) {
    const dist = Math.abs(Date.UTC(year, month - 1, day) - instant.getTime());
    if (dist < bestDist) {
      bestDist = dist;
      best = year;
    }
  }
  return best;
}

/**
 * Parse the date out of a Momence lookup row label such as
 * "powerCycle Express · Fri, 4 Sept, 7:15 pm · Anisha Shah · …".
 * Returns YYYY-MM-DD (nearest-year resolved) or undefined when absent.
 */
export function rowDateToIso(label: string, instant: Date = new Date()): string | undefined {
  const m = label.match(/[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]{3,9})/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const key = m[2].slice(0, 4).toLowerCase();
  const month = MONTHS[key === "sept" ? "sept" : key.slice(0, 3)];
  if (!Number.isFinite(day) || day < 1 || day > 31 || !month) return undefined;
  const year = nearestYear(instant, month, day);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
