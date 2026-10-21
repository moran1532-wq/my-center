/** "Every 3 days at 08:00 Israel time" - pure date math, no timers. */

const TZ = "Asia/Jerusalem";
export const REPORT_EVERY_DAYS = 3;
export const REPORT_HOUR = 8;

/** Israel's UTC offset in minutes at a given moment (handles summer/winter time). */
function israelOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The first 08:00 Israel time that is at or after `from`. */
export function next0800(from: Date): Date {
  for (let day = 0; day < 3; day++) {
    const probe = new Date(from.getTime() + day * 86400000);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(probe);
    const [y, m, d] = parts.split("-").map(Number);
    const guess = new Date(Date.UTC(y, m - 1, d, REPORT_HOUR, 0));
    const candidate = new Date(guess.getTime() - israelOffsetMinutes(guess) * 60000);
    if (candidate.getTime() >= from.getTime()) return candidate;
  }
  throw new Error("unreachable");
}

/** When the next scheduled report is due. `lastAt` = the last scheduled report (manual ones don't move the schedule). */
export function nextReportDue(lastScheduledAt: string | null, now: Date): Date {
  if (!lastScheduledAt) return next0800(now);
  // a little slack so a report sent at 08:00:30 still counts as "08:00" three days later
  const earliest = new Date(new Date(lastScheduledAt).getTime() + REPORT_EVERY_DAYS * 86400000 - 30 * 60000);
  return next0800(earliest);
}
