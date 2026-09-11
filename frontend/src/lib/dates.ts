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
