const DEPT_COLOR: Record<string, string> = { ENGG: "#2563eb", SIGNAL: "#9333ea", TRD: "#ea580c" };

interface SnapshotRow {
  corridor_id: string;
  department: string;
  allocated_start: string;
  allocated_end: string;
  defect_type?: string;
  severity_code?: string;
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function widthPct(startIso: string, endIso: string): number {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  return Math.max((mins / 1440) * 100, 0.6);
}

export function SnapshotGantt({ rows, rangeStart, rangeEnd }: { rows: SnapshotRow[]; rangeStart: string; rangeEnd: string }) {
  const days: string[] = [];
  const cursor = new Date(rangeStart + "T00:00:00");
  const end = new Date(rangeEnd + "T00:00:00");
  while (cursor <= end) {
    days.push(dateKey(cursor.toISOString()));
    cursor.setDate(cursor.getDate() + 1);
  }

  if (rows.length === 0) {
    return <p className="text-xs text-ops-muted p-3 border border-ops-border">No blocks for this corridor in this snapshot.</p>;
  }

  return (
    <div className="border border-ops-border">
      <div className="divide-y divide-ops-border">
        {days.map((day) => {
          const dayRows = rows.filter((r) => dateKey(r.allocated_start) === day);
          return (
            <div key={day} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-24 shrink-0 text-[10px] text-ops-muted mono">
                {new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </span>
              <div className="relative flex-1 h-6 bg-ops-inset">
                {dayRows.map((r, i) => (
                  <div
                    key={i}
                    className="absolute top-0.5 h-5"
                    style={{ left: `${(minuteOfDay(r.allocated_start) / 1440) * 100}%`, width: `${widthPct(r.allocated_start, r.allocated_end)}%`, background: DEPT_COLOR[r.department] ?? "#2563eb" }}
                    title={`${r.department} · ${(r.defect_type ?? "").replace(/_/g, " ")} · ${fmtTime(r.allocated_start)}–${fmtTime(r.allocated_end)}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
