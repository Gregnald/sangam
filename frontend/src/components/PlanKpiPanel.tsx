import { useEffect, useState } from "react";
import { api, ApiError, qs } from "../lib/api";
import { periodLabelText, planPeriodLabel } from "../lib/dates";
import type { PeriodKpis, PlanKpis } from "../types/api";

const DEPT_COLOR: Record<string, string> = { ENGG: "#2563eb", SIGNAL: "#9333ea", TRD: "#ea580c" };

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" | "muted" }) {
  const toneClass = tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-ops-text";
  return (
    <div className="border border-ops-border px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ops-muted truncate">{label}</p>
      <p className={`text-lg font-semibold mono leading-tight ${toneClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-ops-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function Ratio({ label, num, den, invert }: { label: string; num: number; den: number; invert?: boolean }) {
  const pct = den > 0 ? (num / den) * 100 : 0;
  const good = invert ? pct === 0 : pct >= 80;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-44 shrink-0 text-ops-muted">{label}</span>
      <div className="flex-1 h-1.5 bg-ops-inset-strong relative">
        <div className="absolute inset-y-0 left-0" style={{ width: `${Math.min(pct, 100)}%`, background: good ? "#34d399" : "#fbbf24" }} />
      </div>
      <span className="w-20 text-right mono text-ops-text">
        {num}/{den}
      </span>
    </div>
  );
}

export function PlanKpiPanel({ planId, refreshKey }: { planId: string; refreshKey?: string | number | null }) {
  const [kpis, setKpis] = useState<PlanKpis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKpis(null);
    setError(null);
    api
      .get<PlanKpis>(`/api/v1/plans/${planId}/kpis`)
      .then((k) => !cancelled && setKpis(k))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [planId, refreshKey]);

  if (error) return <p className="text-[11px] text-red-400 px-3 py-2">Could not load KPIs: {error}</p>;
  if (!kpis) return <p className="text-[11px] text-ops-muted px-3 py-2">Computing availability KPIs…</p>;
  return <KpiBody kpis={kpis} heading={`Asset availability · ${planPeriodLabel(kpis)} · ${kpis.zone} · ${kpis.days} days`} />;
}

/**
 * One period across every zone: the backend picks one plan per zone (approved
 * preferred), sums counts and hours and re-derives the percentages from the
 * sums — so the availability figure is the railway's, not an average of zones.
 */
export function PeriodKpiPanel({ horizon, period, statuses, refreshKey }: { horizon: "monthly" | "weekly"; period: string; statuses: string; refreshKey?: string | number | null }) {
  const [kpis, setKpis] = useState<PeriodKpis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setKpis(null);
    setError(null);
    api
      .get<PeriodKpis>(`/api/v1/plans/kpis${qs({ horizon, period, statuses })}`)
      .then((k) => !cancelled && setKpis(k))
      .catch((e) => !cancelled && setError(e instanceof ApiError && e.status === 404 ? "" : String(e)));
    return () => {
      cancelled = true;
    };
  }, [horizon, period, statuses, refreshKey]);

  if (error === "") return <p className="text-[11px] text-ops-muted px-3 py-2 border border-ops-border">No plans for this period.</p>;
  if (error) return <p className="text-[11px] text-red-400 px-3 py-2">Could not load KPIs: {error}</p>;
  if (!kpis) return <p className="text-[11px] text-ops-muted px-3 py-2">Consolidating availability KPIs across zones…</p>;

  const total = kpis.zonesIncluded.length + kpis.zonesMissing.length;
  const statusLine = Object.entries(kpis.statusCounts)
    .map(([st, n]) => `${n} ${st.replace(/_/g, " ")}`)
    .join(" · ");
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-left text-[11px] text-ops-muted px-1 py-1 hover:text-ops-text">
        <span>
          All zones consolidated — {kpis.zonesIncluded.length} of {total} zones have a plan ({statusLine})
          {kpis.zonesMissing.length > 0 && <span className="ml-2 text-ops-muted/80">· no plan: {kpis.zonesMissing.join(", ")}</span>}
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && <KpiBody kpis={kpis} heading={`Asset availability · ${periodLabelText(horizon, period, kpis.horizonStart, kpis.horizonEnd)} · all zones (${kpis.zonesIncluded.length}) · ${kpis.days} days`} />}
    </div>
  );
}

export function KpiBody({ kpis, heading }: { kpis: PlanKpis | PeriodKpis; heading: string }) {
  const hoursSavedPct = kpis.jobHours > 0 ? (kpis.hoursSavedByJointBlocks / kpis.jobHours) * 100 : 0;
  const scheduledPct = kpis.openBacklog > 0 ? (kpis.jobsScheduled / kpis.openBacklog) * 100 : 0;
  const depts = Object.entries(kpis.departments).sort(([a], [b]) => a.localeCompare(b));
  const totalDeptHours = depts.reduce((s, [, d]) => s + d.hours, 0);

  return (
    <div className="border border-ops-border bg-ops-inset">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-ops-border">
        <p className="text-[10px] uppercase tracking-wide text-ops-muted">{heading}</p>
        <p className="text-[10px] text-ops-muted">
          {kpis.weeklyPlansIncluded > 0 && (
            <span className="mr-3">
              includes {kpis.weeklyPlansIncluded} approved weekly plan{kpis.weeklyPlansIncluded === 1 ? "" : "s"} inside this month
            </span>
          )}
          {kpis.affectedCorridors} of {kpis.corridorsInZone} corridors under possession at some point
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
        <Tile
          label="Availability (affected corridors)"
          value={`${kpis.availabilityPctAffected.toFixed(2)}%`}
          sub={
            kpis.hoursSavedByJointBlocks > 0
              ? `${kpis.availabilityPctAffectedUnbundled.toFixed(2)}% if every job took its own block`
              : `${kpis.possessionHours.toFixed(1)} h under possession of ${(kpis.affectedCorridors * 24 * kpis.days).toLocaleString()} h`
          }
          tone="good"
        />
        <Tile label="Availability (all corridors)" value={`${kpis.availabilityPct.toFixed(3)}%`} sub={`${kpis.possessionHours.toFixed(1)} h of ${kpis.corridorHoursAvailable.toLocaleString()} corridor-hours`} />
        <Tile
          label="Block events"
          value={String(kpis.blockEvents)}
          sub={`${kpis.jobsScheduled} jobs · ${kpis.jointBlocks} shared · ${kpis.multiDeptBlocks} multi-department`}
        />
        <Tile
          label="Downtime saved by bundling"
          value={`${kpis.hoursSavedByJointBlocks.toFixed(1)} h`}
          sub={kpis.jobHours > 0 ? `${hoursSavedPct.toFixed(0)}% of ${kpis.jobHours.toFixed(1)} job-hours` : "no jobs placed"}
          tone={kpis.hoursSavedByJointBlocks > 0 ? "good" : "muted"}
        />
        <Tile
          label="Backlog scheduled"
          value={`${scheduledPct.toFixed(0)}%`}
          sub={`${kpis.jobsScheduled} of ${kpis.openBacklog} open requests in zone`}
          tone={scheduledPct >= 80 ? "good" : scheduledPct >= 50 ? "warn" : "bad"}
        />
        <Tile
          label="On time vs due date"
          value={`${kpis.scheduledOnTime}/${kpis.jobsScheduled}`}
          sub={kpis.scheduledLate > 0 ? `${kpis.scheduledLate} placed after due date (best available)` : "every placed job meets its due date"}
          tone={kpis.scheduledLate === 0 ? "good" : "warn"}
        />
        <Tile
          label="Passenger trains affected"
          value={String(kpis.passengerTrainsAffected)}
          sub="timetabled runs through a blocked corridor during its block"
          tone={kpis.passengerTrainsAffected === 0 ? "good" : "bad"}
        />
        <Tile
          label="Goods paths protected"
          value={`${kpis.goodsPathsForecast - kpis.goodsPathsConflicting}/${kpis.goodsPathsForecast}`}
          sub={
            kpis.goodsPathsForecast === 0
              ? "no COA forecast loaded for this horizon"
              : kpis.goodsPathsConflicting > 0
                ? `${kpis.goodsPathsConflicting} forecast path(s) overlap a block — regenerate to honour the forecast`
                : "no block sits on a forecast freight path"
          }
          tone={kpis.goodsPathsForecast === 0 ? "muted" : kpis.goodsPathsConflicting === 0 ? "good" : "warn"}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 px-3 pb-3">
        <Ratio label="Severity A (safety-critical) placed" num={kpis.severityAScheduled} den={kpis.severityATotal} />
        <Ratio label="Speed restrictions cleared" num={kpis.speedRestrictionsScheduled} den={kpis.speedRestrictionsTotal} />
        <Ratio label="Overdue at start of horizon placed" num={kpis.overdueScheduled} den={kpis.overdueTotal} />
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-44 shrink-0 text-ops-muted">Possession hours by department</span>
          <div className="flex-1 h-1.5 bg-ops-inset-strong flex overflow-hidden">
            {depts.map(([name, d]) => (
              <div key={name} style={{ width: `${totalDeptHours > 0 ? (d.hours / totalDeptHours) * 100 : 0}%`, background: DEPT_COLOR[name] ?? "#64748b" }} title={`${name}: ${d.hours} h`} />
            ))}
          </div>
          <span className="w-20 text-right mono text-ops-text">{totalDeptHours.toFixed(1)} h</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pb-2 text-[10px] text-ops-muted">
        {depts.map(([name, d]) => (
          <span key={name} className="flex items-center gap-1">
            <span className="w-2 h-2 inline-block" style={{ background: DEPT_COLOR[name] ?? "#64748b" }} />
            {name}: {d.jobs}/{d.open} jobs · {d.hours} h
          </span>
        ))}
      </div>
    </div>
  );
}
