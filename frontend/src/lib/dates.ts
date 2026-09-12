export function mondayOf(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayIso(): string {
  return fmtDate(new Date());
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export function planTimeState(horizonStart: string, horizonEnd: string): "past" | "current" | "upcoming" {
  const today = todayIso();
  if (horizonEnd < today) return "past";
  if (horizonStart > today) return "upcoming";
  return "current";
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" → "September 2026". */
export function monthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Monday of ISO week "2026-W38" (ISO 8601: week 1 contains 4 January). */
export function isoWeekMonday(period: string): Date | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!m) return null;
  const jan4 = new Date(Number(m[1]), 0, 4);
  const week1Monday = mondayOf(jan4);
  return addDays(week1Monday, (Number(m[2]) - 1) * 7);
}

function dayMonth(d: Date, withYear: boolean): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** "2026-W38" (+ optional YYYY-MM-DD bounds) → "Week 38 · 14 Sep – 20 Sep 2026". */
export function weekLabel(period: string, horizonStart?: string | null, horizonEnd?: string | null): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(period);
  const start = horizonStart ? new Date(horizonStart + "T00:00:00") : isoWeekMonday(period);
  if (!start) return period;
  const end = horizonEnd ? new Date(horizonEnd + "T00:00:00") : addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const num = m ? String(Number(m[2])) : "?";
  return `Week ${num} · ${dayMonth(start, !sameYear)} – ${dayMonth(end, true)}`;
}

export function periodLabelText(horizon: "monthly" | "weekly" | string, period: string, horizonStart?: string | null, horizonEnd?: string | null): string {
  return horizon === "weekly" ? weekLabel(period, horizonStart, horizonEnd) : monthLabel(period);
}

export function planPeriodLabel(plan: { horizonType: string; periodLabel: string; horizonStart: string; horizonEnd: string }): string {
  return periodLabelText(plan.horizonType, plan.periodLabel, plan.horizonStart, plan.horizonEnd);
}
