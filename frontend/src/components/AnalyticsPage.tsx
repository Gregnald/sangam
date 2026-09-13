import { useEffect, useMemo, useState } from "react";
import { api, qs } from "../lib/api";
import { IST_TZ, monthLabel } from "../lib/dates";
import { useAppStore } from "../store/appStore";
import type { CorridorRow, MonthAnalytics } from "./analytics/types";
import { DEPT_COLOR } from "./analytics/palette";
import {
  BacklogChart,
  BundlingChart,
  CumulativeChart,
  DailyChart,
  DepartmentChart,
  LeadTimeChart,
  MonthCalendarChart,
  PriorityChart,
  TimeOfDayChart,
  TopCorridorsChart,
  WorkTypesChart,
  ZonesChart,
} from "./analytics/charts";

type SortKey = keyof CorridorRow;

export function AnalyticsPage() {
  const zones = useAppStore((s) => s.zones);
  const fetchZones = useAppStore((s) => s.fetchZones);
  const planRevision = useAppStore((s) => s.planRevision);
  const [months, setMonths] = useState<string[]>([]);
  const [period, setPeriod] = useState<string>("");
  const [zone, setZone] = useState<string>("");
  const [data, setData] = useState<MonthAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "possessionHours", dir: -1 });
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (zones.length === 0) fetchZones();
    let cancelled = false;
    api.get<string[]>("/api/v1/analytics/months").then((m) => {
      if (cancelled) return;
      setMonths(m);
      const now = new Date();
      const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      setPeriod((p) => p || (m.includes(cur) ? cur : m[0] ?? ""));
    });
    return () => {
      cancelled = true;
    };
  }, [zones.length, fetchZones]);

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    api
      .get<MonthAnalytics>(`/api/v1/analytics/month${qs({ period, zone: zone || undefined })}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [period, zone, planRevision]);

  const corridorRows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const rows = q ? data.corridors.filter((c) => `${c.corridorId} ${c.stations} ${c.zone}`.toLowerCase().includes(q)) : data.corridors;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
  }, [data, query, sort]);

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  const th = (k: SortKey, label: string, right = true) => (
    <th className={`p-2 cursor-pointer select-none whitespace-nowrap ${right ? "text-right" : "text-left"} ${sort.key === k ? "text-ops-text" : ""}`} onClick={() => toggleSort(k)}>
      {label}
      {sort.key === k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );

  if (!period) return <p className="text-xs text-ops-muted p-4 border border-ops-border">No months with data yet.</p>;

  const s = data?.summary;
  const visibleCorridors = showAll ? corridorRows : corridorRows.slice(0, 40);
  const scheduledPct = s ? (s.jobsScheduled / Math.max(s.backlogTotal - s.backlogCompleted, 1)) * 100 : 0;
  const onTimePct = s && s.jobsScheduled ? (s.scheduledOnTime / s.jobsScheduled) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ops-text leading-tight">
            {monthLabel(period)} <span className="text-ops-muted font-normal">·</span> {zone || "All zones"}
          </h2>
          <p className="text-[11px] text-ops-muted mt-1">
            {data ? `${data.start} – ${data.end} · ${data.days} days · ` : ""}live schedule — approved plans, weekly authoritative over monthly · all times IST
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="bg-ops-panel border border-ops-border text-ops-text px-2.5 py-1.5">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <select value={zone} onChange={(e) => setZone(e.target.value)} className="bg-ops-panel border border-ops-border text-ops-text px-2.5 py-1.5">
            <option value="">All zones</option>
            {zones.map((z) => (
              <option key={z.zone ?? "none"} value={z.zone ?? ""}>
                {z.zone}
              </option>
            ))}
          </select>
          {zone && (
            <button onClick={() => setZone("")} className="px-2.5 py-1.5 border border-ops-border text-ops-muted hover:text-ops-text">
              All zones
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {!data && !error && <p className="text-xs text-ops-muted">Computing…</p>}

      {data && s && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <Headline
              label="Availability · affected corridors"
              value={`${s.availabilityPctAffected.toFixed(2)}%`}
              note={`${s.availabilityPctAffectedUnbundled.toFixed(2)}% if every job took its own block`}
              tone="good"
              bar={s.availabilityPctAffected}
              info={`Of the ${s.affectedCorridors} corridors that go under possession this month, ${s.possessionHours.toFixed(1)} h of ${(s.affectedCorridors * 24 * data.days).toLocaleString()} corridor-hours are blocked — ${s.availabilityPctAffected.toFixed(2)}% of their time is open to trains. Without bundling jobs into shared possessions it would be ${s.availabilityPctAffectedUnbundled.toFixed(2)}%. Computed from the live schedule: approved plans, with a week's own weekly plan overriding the monthly copy.`}
            />
            <Headline
              label="Possession"
              value={`${s.possessionHours.toFixed(0)} h`}
              note={`${s.blockEvents} block events · ${s.jobsScheduled} jobs · ${s.affectedCorridors} corridors`}
              bar={s.jobHours > 0 ? (s.possessionHours / s.jobHours) * 100 : 0}
              barLabel={`${s.hoursSavedByJointBlocks.toFixed(0)} h saved by bundling`}
              info={`${s.blockEvents} possessions are taken this month, carrying ${s.jobsScheduled} jobs on ${s.affectedCorridors} corridors. The jobs add up to ${s.jobHours.toFixed(1)} h of work but the corridors are blocked for only ${s.possessionHours.toFixed(1)} h, because ${s.jointBlocks} possessions are shared (${s.multiDeptBlocks} across departments). The bar shows possession hours as a share of job-hours — lower is better bundling.`}
            />
            <Headline
              label="Backlog placed"
              value={`${scheduledPct.toFixed(0)}%`}
              note={`${s.jobsScheduled} placed · ${s.backlogOpen} open · ${s.backlogCompleted} completed`}
              tone={scheduledPct >= 80 ? "good" : scheduledPct >= 50 ? "warn" : "bad"}
              bar={scheduledPct}
              info={`${s.jobsScheduled} jobs have a block this month out of ${s.backlogTotal - s.backlogCompleted} requests still needing one (${s.backlogTotal} in scope for the month, ${s.backlogCompleted} already completed). ${s.backlogOpen} are still open: waiting on a solve, an alternate-window offer, a controller decision, or a long-enough gap that doesn't exist yet.`}
            />
            <Headline
              label="Due-date performance"
              value={`${onTimePct.toFixed(0)}%`}
              note={`${s.scheduledOnTime} on time · ${s.scheduledLate} late · ${s.backlogOverdueOpen} open & overdue`}
              tone={s.backlogOverdueOpen === 0 && s.scheduledLate === 0 ? "good" : s.backlogOverdueOpen > 0 ? "bad" : "warn"}
              bar={onTimePct}
              info={`${s.scheduledOnTime} of ${s.jobsScheduled} placed jobs start on or before their due date; ${s.scheduledLate} start after it because no earlier window could take them. ${s.backlogOverdueOpen} request${s.backlogOverdueOpen === 1 ? " is" : "s are"} past due and still not placed${s.backlogOverdueOpen > 0 ? " — usually because the job is longer than any timetable gap on its corridor" : ""}.`}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2">
            <Tile label="Blocks cancelling trains" value={String(s.blocksCancellingTrains)} sub="section unsafe during repair" tone={s.blocksCancellingTrains === 0 ? "good" : "bad"} info={`${s.blocksCancellingTrains} block${s.blocksCancellingTrains === 1 ? "" : "s"} this month belong to faults flagged as unsafe for trains. Those blocks are placed over the timetable instead of in a gap, and every train that overlaps them is cancelled or postponed.`} />
            <Tile label="Trains cancelled" value={String(s.trainsCancelled)} sub="timetabled runs overlapping those blocks" tone={s.trainsCancelled === 0 ? "good" : "bad"} info={`${s.trainsCancelled} timetabled train passage${s.trainsCancelled === 1 ? "" : "s"} fall inside a block whose fault is unsafe for traffic. Counted per train per day from the timetable in force that day; the table below lists them per block.`} />
            <Tile label="Availability (all)" value={`${s.availabilityPct.toFixed(3)}%`} sub={`${s.corridors.toLocaleString()} corridors`} info={`Across all ${s.corridors.toLocaleString()} corridors in scope, ${s.possessionHours.toFixed(1)} h of ${s.corridorHoursAvailable.toLocaleString()} corridor-hours are blocked. Dominated by corridors with no block at all, so it stays close to 100% — compare months with it rather than judge one.`} />
            <Tile label="Shared blocks" value={String(s.jointBlocks)} sub={`${s.multiDeptBlocks} multi-department`} info={`${s.jointBlocks} of the ${s.blockEvents} possessions hold more than one job; ${s.multiDeptBlocks} have crews from different departments working side by side. Sharing is what saves the ${s.hoursSavedByJointBlocks.toFixed(0)} h of downtime.`} />
            <Tile label="Job-hours" value={`${s.jobHours.toFixed(0)} h`} sub="if unbundled" info={`The sum of every placed job's estimated hours — what the corridors would be blocked for if each job took its own possession. The actual possession time is ${s.possessionHours.toFixed(0)} h.`} />
            <Tile label="Severity A placed" value={String(s.severityAScheduled)} sub={`${s.speedRestrictionsScheduled} with SR`} info={`${s.severityAScheduled} safety-critical (Severity A) jobs have a block this month, ${s.speedRestrictionsScheduled} of all placed jobs carry an active speed restriction that the block will clear.`} />
            <Tile label="Rescheduled" value={String(s.rescheduledFromOverdue)} sub={`${s.systemPlanned} via system plans`} tone={s.rescheduledFromOverdue > 0 ? "warn" : "muted"} info={`${s.rescheduledFromOverdue} of the placed jobs were overdue when the daily sweep placed them (they carry the RESCHEDULED tag). ${s.systemPlanned} sit in plans the system solved itself for weeks the controller had not planned yet.`} />
            <Tile label="Open & overdue" value={String(s.backlogOverdueOpen)} sub="not yet placed" tone={s.backlogOverdueOpen === 0 ? "good" : "bad"} info={`Requests past their due date with no block anywhere. The sweep tries every week ahead for them daily; the ones left are longer than any timetable gap on their corridor and need a longer possession or a split job.`} />
            <Tile label="Avg priority" value={s.avgPriority != null ? s.avgPriority.toFixed(1) : "—"} sub="XGBoost ranker" info={`Mean priority score (0–100) over the ${s.backlogTotal} requests in scope, from the XGBoost ranker: overdue days, severity, speed restriction, defect-type failure rate, corridor traffic, deferrals. Severity A with a speed restriction is floored at 90; a fault unsafe for traffic at 98.`} />
            <Tile label="Deferrals" value={s.avgDeferCount.toFixed(2)} sub={`max ${s.maxDeferCount}`} info={`How many planning cycles requests have missed on average (max ${s.maxDeferCount}). Each deferral raises a request's priority so it can't starve.`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <ChartCard title="Possession by day" caption="Switch the metric; drag the brush to zoom into a range" wide h={300}>
              <DailyChart d={data} />
            </ChartCard>
            <ChartCard title="Spread over the month" caption="Calendar of the month — each day shaded by how much it carries; switch the metric" h={300}>
              <MonthCalendarChart d={data} />
            </ChartCard>
            <ChartCard title="Time of day" caption="Possession hours falling in each hour of the day, and how many blocks start then" h={300}>
              <TimeOfDayChart d={data} />
            </ChartCard>
            <ChartCard title="Departments" caption="Share of possession hours; jobs placed · open · overdue · rescheduled" h={250}>
              <DepartmentChart d={data} />
            </ChartCard>
            <ChartCard title="Bundling" caption="Single, shared and multi-department block events; job-hours vs actual possession" h={250}>
              <BundlingChart d={data} />
            </ChartCard>
            <ChartCard title="Backlog" caption="Requests in scope for the month by status and severity" h={240}>
              <BacklogChart d={data} />
            </ChartCard>
            <ChartCard title="Lead time" caption="Block start relative to due date, per placed job" h={240}>
              <LeadTimeChart d={data} />
            </ChartCard>
            <ChartCard title="Priority" caption="Ranker scores across the month's backlog; ≥ 90 is the safety floor" h={240}>
              <PriorityChart d={data} />
            </ChartCard>
            <ChartCard title="Cumulative possession" caption="Running totals of possession hours and jobs through the month" h={240}>
              <CumulativeChart d={data} />
            </ChartCard>
            {!zone && (
              <ChartCard title="Zones" caption="Click a zone to drill in — possession, open and overdue requests, availability of affected corridors" wide h={280}>
                <ZonesChart d={data} onPick={setZone} />
              </ChartCard>
            )}
            <ChartCard title="Top corridors" caption="Possession hours with bundling savings" h={330}>
              <TopCorridorsChart d={data} />
            </ChartCard>
            <ChartCard title="Work types" caption="Jobs placed (department colour) vs still open" h={330}>
              <WorkTypesChart d={data} />
            </ChartCard>
          </div>

          {data.closures.length > 0 && (
            <Section title={`Blocks cancelling trains · ${data.closures.length}`} right={<span className="text-[10px] text-ops-muted">timetabled runs overlapping a block whose fault is unsafe for traffic</span>}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ops-muted uppercase text-[10px]">
                    <tr>
                      <th className="text-left p-2">Corridor</th>
                      <th className="text-left p-2">Zone</th>
                      <th className="text-left p-2">Dept</th>
                      <th className="text-left p-2">Fault</th>
                      <th className="text-left p-2">Block</th>
                      <th className="text-right p-2">Trains cancelled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ops-border">
                    {data.closures.map((c) => (
                      <tr key={c.defectId} className="hover:bg-ops-hover">
                        <td className="p-2 mono text-ops-text">{c.corridorId}</td>
                        <td className="p-2 mono text-ops-muted">{c.zone}</td>
                        <td className="p-2 font-semibold" style={{ color: DEPT_COLOR[c.department] }}>{c.department}</td>
                        <td className="p-2 text-ops-text">{c.defectType.replace(/_/g, " ")} <span className="text-ops-muted mono">#{c.defectId.slice(0, 8).toUpperCase()}</span></td>
                        <td className="p-2 mono text-ops-muted">{new Date(c.blockStart).toLocaleString(undefined, { timeZone: IST_TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} – {new Date(c.blockEnd).toLocaleTimeString([], { timeZone: IST_TZ, hour: "2-digit", minute: "2-digit" })}</td>
                        <td className={`p-2 text-right mono ${c.trainsCancelled > 0 ? "text-red-400" : "text-ops-muted"}`}>{c.trainsCancelled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {!zone && (
            <Section title="Zones" right={<span className="text-[10px] text-ops-muted">click a row to drill in</span>}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ops-muted uppercase text-[10px]">
                    <tr>
                      <th className="text-left p-2">Zone</th>
                      <th className="text-right p-2">Corridors</th>
                      <th className="text-right p-2">Under possession</th>
                      <th className="text-right p-2">Block events</th>
                      <th className="text-right p-2">Jobs</th>
                      <th className="text-right p-2">Shared</th>
                      <th className="text-right p-2">Possession h</th>
                      <th className="text-right p-2">Avail. (affected)</th>
                      <th className="text-right p-2">Avail. (all)</th>
                      <th className="text-right p-2">Open</th>
                      <th className="text-right p-2">Overdue</th>
                      <th className="text-right p-2">Rescheduled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ops-border">
                    {data.zones.map((z) => (
                      <tr key={z.zone} className="hover:bg-ops-hover cursor-pointer" onClick={() => setZone(z.zone)}>
                        <td className="p-2 mono font-semibold text-ops-text">{z.zone}</td>
                        <td className="p-2 text-right mono text-ops-muted">{z.corridors}</td>
                        <td className="p-2 text-right mono text-ops-text">{z.affectedCorridors}</td>
                        <td className="p-2 text-right mono text-ops-text">{z.blockEvents}</td>
                        <td className="p-2 text-right mono text-ops-text">{z.jobs}</td>
                        <td className="p-2 text-right mono text-ops-text">{z.jointBlocks}</td>
                        <td className="p-2 text-right mono text-ops-text">{z.possessionHours.toFixed(1)}</td>
                        <td className="p-2 text-right mono text-emerald-400">{z.blockEvents ? `${z.availabilityPctAffected.toFixed(2)}%` : "—"}</td>
                        <td className="p-2 text-right mono text-ops-muted">{z.availabilityPct.toFixed(3)}%</td>
                        <td className={`p-2 text-right mono ${z.openRequests > 0 ? "text-amber-400" : "text-ops-muted"}`}>{z.openRequests}</td>
                        <td className={`p-2 text-right mono ${z.overdueRequests > 0 ? "text-red-400" : "text-ops-muted"}`}>{z.overdueRequests}</td>
                        <td className={`p-2 text-right mono ${z.rescheduled > 0 ? "text-blue-400" : "text-ops-muted"}`}>{z.rescheduled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section
            title={`Corridors · ${corridorRows.length} with blocks or open requests`}
            right={<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter corridor / station / zone…" className="text-[11px] bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-56" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ops-muted uppercase text-[10px]">
                  <tr>
                    {th("corridorId", "Corridor", false)}
                    <th className="text-left p-2">Section</th>
                    {th("zone", "Zone", false)}
                    {th("trainCount", "Trains/day")}
                    {th("blockEvents", "Blocks")}
                    {th("jobs", "Jobs")}
                    <th className="text-left p-2">Depts</th>
                    {th("jointBlocks", "Shared")}
                    {th("possessionHours", "Possession h")}
                    {th("hoursSaved", "Saved h")}
                    {th("availabilityPct", "Availability")}
                    {th("onTime", "On time")}
                    {th("late", "Late")}
                    {th("severityA", "Sev A")}
                    {th("rescheduled", "Resched.")}
                    {th("openRequests", "Open")}
                    {th("overdueRequests", "Overdue")}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ops-border">
                  {visibleCorridors.length === 0 && (
                    <tr>
                      <td colSpan={17} className="p-4 text-center text-ops-muted">Nothing matches.</td>
                    </tr>
                  )}
                  {visibleCorridors.map((c) => (
                    <tr key={c.corridorId} className="hover:bg-ops-hover">
                      <td className="p-2 mono text-ops-text whitespace-nowrap">{c.corridorId}</td>
                      <td className="p-2 mono text-ops-muted whitespace-nowrap">{c.stations}</td>
                      <td className="p-2 mono text-ops-muted">{c.zone}</td>
                      <td className="p-2 text-right mono text-ops-muted">{c.trainCount}</td>
                      <td className="p-2 text-right mono text-ops-text">{c.blockEvents}</td>
                      <td className="p-2 text-right mono text-ops-text">{c.jobs}</td>
                      <td className="p-2">
                        {c.departments.map((d) => (
                          <span key={d} className="inline-block w-2 h-2 mr-1 rounded-sm" style={{ background: DEPT_COLOR[d] }} title={d} />
                        ))}
                      </td>
                      <td className="p-2 text-right mono text-ops-text">{c.jointBlocks}</td>
                      <td className="p-2 text-right mono text-ops-text">{c.possessionHours.toFixed(1)}</td>
                      <td className={`p-2 text-right mono ${c.hoursSaved > 0 ? "text-emerald-400" : "text-ops-muted"}`}>{c.hoursSaved.toFixed(1)}</td>
                      <td className="p-2 text-right mono text-ops-text">{c.blockEvents ? `${c.availabilityPct.toFixed(2)}%` : "—"}</td>
                      <td className="p-2 text-right mono text-ops-text">{c.onTime}</td>
                      <td className={`p-2 text-right mono ${c.late > 0 ? "text-amber-400" : "text-ops-muted"}`}>{c.late}</td>
                      <td className={`p-2 text-right mono ${c.severityA > 0 ? "text-red-400" : "text-ops-muted"}`}>{c.severityA}</td>
                      <td className={`p-2 text-right mono ${c.rescheduled > 0 ? "text-blue-400" : "text-ops-muted"}`}>{c.rescheduled}</td>
                      <td className={`p-2 text-right mono ${c.openRequests > 0 ? "text-amber-400" : "text-ops-muted"}`}>{c.openRequests}</td>
                      <td className={`p-2 text-right mono ${c.overdueRequests > 0 ? "text-red-400" : "text-ops-muted"}`}>{c.overdueRequests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {corridorRows.length > 40 && (
              <button onClick={() => setShowAll((v) => !v)} className="w-full text-[11px] text-ops-accent py-1.5 border-t border-ops-border hover:bg-ops-hover">
                {showAll ? "Show top 40" : `Show all ${corridorRows.length}`}
              </button>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone, info }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" | "muted"; info?: string }) {
  const [open, setOpen] = useState(false);
  const toneClass = tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-ops-text";
  return (
    <div
      className={`border border-ops-border px-3 py-2 min-w-0 bg-ops-panel ${info ? "cursor-pointer hover:bg-ops-hover" : ""} ${open ? "col-span-2 md:col-span-5 xl:col-span-5 bg-ops-raise" : ""}`}
      onClick={() => info && setOpen((o) => !o)}
      title={info && !open ? "Click for what this means" : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-ops-muted truncate">{label}</p>
          <p className={`text-lg font-semibold mono leading-tight ${toneClass}`}>{value}</p>
          {sub && (
            <p className="text-[10px] text-ops-muted mt-0.5 truncate" title={sub}>
              {sub}
            </p>
          )}
        </div>
        {info && <span className="text-[10px] text-ops-muted shrink-0">{open ? "▲" : "ⓘ"}</span>}
      </div>
      {open && info && <p className="text-[11px] text-ops-text mt-2 pt-2 border-t border-ops-border leading-relaxed">{info}</p>}
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-ops-border bg-ops-panel overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ops-border">
        <p className="text-xs font-semibold text-ops-text">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A big number with a caption and a thin progress bar underneath. */
function Headline({ label, value, note, tone, bar, barLabel, info }: { label: string; value: string; note: string; tone?: "good" | "warn" | "bad"; bar: number; barLabel?: string; info?: string }) {
  const [open, setOpen] = useState(false);
  const color = tone === "good" ? "#34d399" : tone === "warn" ? "#fbbf24" : tone === "bad" ? "#f87171" : "var(--ops-accent)";
  return (
    <div className={`border border-ops-border bg-ops-panel px-4 py-3 ${info ? "cursor-pointer hover:bg-ops-hover" : ""} ${open ? "col-span-2 xl:col-span-4 bg-ops-raise" : ""}`} onClick={() => info && setOpen((o) => !o)} title={info && !open ? "Click for what this means" : undefined}>
      <p className="text-[10px] uppercase tracking-wider text-ops-muted flex justify-between">
        {label}
        {info && <span>{open ? "▲" : "ⓘ"}</span>}
      </p>
      <p className="text-2xl font-semibold mono leading-tight mt-1" style={{ color }}>
        {value}
      </p>
      <p className="text-[11px] text-ops-muted mt-1 truncate" title={note}>
        {note}
      </p>
      <div className="h-1 bg-ops-inset-strong mt-2 relative overflow-hidden rounded-full">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, bar))}%`, background: color }} />
      </div>
      {barLabel && <p className="text-[10px] text-ops-muted mt-1">{barLabel}</p>}
      {open && info && <p className="text-[11px] text-ops-text mt-2 pt-2 border-t border-ops-border leading-relaxed">{info}</p>}
    </div>
  );
}

function ChartCard({ title, caption, children, wide, h }: { title: string; caption: string; children: React.ReactNode; wide?: boolean; h: number }) {
  return (
    <div className={`border border-ops-border bg-ops-panel overflow-hidden ${wide ? "xl:col-span-2" : ""}`}>
      <div className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-ops-border">
        <p className="text-xs font-semibold text-ops-text">{title}</p>
        <p className="text-[10px] text-ops-muted truncate">{caption}</p>
      </div>
      <div className="p-2" style={{ height: h }}>
        {children}
      </div>
    </div>
  );
}
