import { IST_TZ } from "../../lib/dates";
import { useMemo, useState } from "react";
import { CorridorGantt } from "../CorridorGantt";
import { DISPLAY_COLOR, DISPLAY_LABEL, DISPLAY_ORDER, EVENT_LABEL, blockDay, displayStatus, isRescheduled, possessionLabel, shortId, type DisplayStatus } from "../../lib/requestStatus";
import type { DefectRequest } from "../../types/api";

const SEV_COLOR: Record<string, string> = { A: "text-red-400", B: "text-amber-400", C: "text-emerald-400" };

type Filter = DisplayStatus | "all" | "past" | "active";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "in_progress", label: "In progress" },
  { key: "upcoming", label: "Scheduled" },
  { key: "requested", label: "Requested" },
  { key: "awaiting_response", label: "Needs my response" },
  { key: "awaiting_controller", label: "Awaiting controller" },
  { key: "overdue", label: "Overdue" },
  { key: "past", label: "Past" },
  { key: "completed", label: "Completed" },
  { key: "cleared", label: "Cleared" },
];

function matches(filter: Filter, ds: DisplayStatus): boolean {
  if (filter === "all") return true;
  if (filter === "past") return ds === "completed" || ds === "cleared";
  if (filter === "active") return ds !== "completed" && ds !== "cleared";
  return ds === filter;
}

function fmtDT(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function BlockCard({ r }: { r: DefectRequest }) {
  const [open, setOpen] = useState(false);
  const ds = displayStatus(r);
  const day = blockDay(r);
  const hasBlock = Boolean(r.allocatedStart && r.allocatedEnd);
  const highlightStart = r.allocatedStart ?? r.requestedWindowStart;
  const highlightEnd = r.allocatedEnd ?? r.requestedWindowEnd;
  const possession = possessionLabel(r);

  return (
    <div className={`border ${open ? "border-ops-accent" : "border-ops-border"}`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-3 py-2.5 hover:bg-ops-hover">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`text-[11px] uppercase font-semibold whitespace-nowrap ${DISPLAY_COLOR[ds]}`}>{DISPLAY_LABEL[ds]}</span>
            {isRescheduled(r) && <span className="text-[10px] font-semibold uppercase text-blue-400 border border-blue-400/40 px-1 py-px">Rescheduled</span>}
            <span className="text-[11px] text-ops-muted mono" title={r.defectId}>#{shortId(r.defectId)}</span>
            <span className="text-xs font-semibold text-ops-text mono">{r.corridorId}</span>
            <span className="text-xs text-ops-text">{r.defectType.replace(/_/g, " ")}</span>
            <span className={`text-[11px] font-semibold ${SEV_COLOR[r.severityCode]}`}>Sev {r.severityCode}</span>
            {possession && <span className={`text-[11px] font-semibold ${possession.joint ? "text-ops-accent" : "text-ops-muted"}`}>{possession.text}</span>}
            {r.deferCount > 0 && <span className="text-[11px] text-amber-400">deferred ×{r.deferCount}</span>}
          </div>
          <div className="text-[12px] text-ops-muted mono text-right">
            {hasBlock ? (
              <>
                {fmtDT(r.allocatedStart)} – {new Date(r.allocatedEnd!).toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })}
                {r.planPeriodLabel && <span className="ml-2 text-ops-muted/80">plan {r.planPeriodLabel}</span>}
              </>
            ) : r.requestedWindowStart ? (
              <>asked for {fmtDT(r.requestedWindowStart)}</>
            ) : (
              <>due {r.dueDate}</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-ops-muted flex-wrap">
          <span>{r.estimatedBlockHours.toFixed(2)} h</span>
          <span>due {r.dueDate}</span>
          {r.speedRestrictionKmph != null && <span className="text-red-400">SR {r.speedRestrictionKmph} km/h</span>}
          {r.priorityScore != null && <span>priority {r.priorityScore.toFixed(0)}/100</span>}
          {r.assetId && <span className="mono">{r.assetId}</span>}
          {r.lastEventType && (
            <span title={r.lastEventDetails ?? undefined}>
              · {EVENT_LABEL[r.lastEventType] ?? r.lastEventType.replace(/_/g, " ")}
              {r.lastEventAt ? ` (${fmtDT(r.lastEventAt)}${r.lastEventActor ? `, ${r.lastEventActor}` : ""})` : ""}
            </span>
          )}
          <span className="ml-auto">{open ? "▲" : "▼ day schedule"}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-ops-border p-3 bg-ops-inset space-y-2">
          {r.lastEventDetails && <p className="text-xs text-ops-muted">{r.lastEventDetails}</p>}
          {r.corridorId ? (
            <CorridorGantt
              corridorId={r.corridorId}
              rangeStart={day}
              rangeEnd={day}
              highlightWindowStart={hasBlock ? null : highlightStart}
              highlightWindowEnd={hasBlock ? null : highlightEnd}
              highlightDefectId={hasBlock ? r.defectId : null}
              highlightLabel={hasBlock ? "This job" : r.requestedWindowStart ? "Window you asked for" : null}
              highlightKind={hasBlock ? "own" : "proposed"}
            />
          ) : (
            <p className="text-xs text-ops-muted">No corridor on this request.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function MyBlocks({ requests }: { requests: DefectRequest[] }) {
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c = new Map<Filter, number>();
    for (const f of FILTERS) c.set(f.key, 0);
    for (const r of requests) {
      const ds = displayStatus(r);
      for (const f of FILTERS) if (matches(f.key, ds)) c.set(f.key, (c.get(f.key) ?? 0) + 1);
    }
    return c;
  }, [requests]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = requests.filter((r) => {
      if (!matches(filter, displayStatus(r))) return false;
      if (!q) return true;
      return [r.corridorId, r.assetId, r.defectType.replace(/_/g, " "), r.planPeriodLabel, r.zone].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
    // Live work first (by block time), then the rest by due date.
    const rank = (r: DefectRequest) => DISPLAY_ORDER.indexOf(displayStatus(r));
    return rows.sort((a, b) => rank(a) - rank(b) || (a.allocatedStart ?? a.dueDate).localeCompare(b.allocatedStart ?? b.dueDate));
  }, [requests, filter, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2 py-1 text-[11px] border ${filter === f.key ? "bg-ops-accent border-ops-accent text-white" : "border-ops-border text-ops-muted hover:text-ops-text"}`}
          >
            {f.label} <span className="opacity-70">{counts.get(f.key) ?? 0}</span>
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search corridor, asset, type…"
          className="ml-auto text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-60"
        />
      </div>
      <div className="space-y-1.5">
        {visible.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">No blocks in this view.</p>}
        {visible.map((r) => (
          <BlockCard key={r.defectId} r={r} />
        ))}
      </div>
    </div>
  );
}
