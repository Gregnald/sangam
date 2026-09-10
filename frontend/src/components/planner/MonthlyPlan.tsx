import { useAppStore } from '../../store/useAppStore';
import type { MaintenanceJob, CandidateWindow, BlockAssignment } from '../../types/domain';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Clock, TrendingUp } from 'lucide-react';

// The monthly plan covers 4 weeks from a base date (Sep 2026 for demo)
const WEEKS = [
  { label: 'Week 1', start: '2026-09-01', end: '2026-09-07' },
  { label: 'Week 2', start: '2026-09-08', end: '2026-09-14' },
  { label: 'Week 3', start: '2026-09-15', end: '2026-09-21' },
  { label: 'Week 4', start: '2026-09-22', end: '2026-09-30' },
];

// How many hours of demand each corridor has per week (derived from jobs)
function getCorridorWeeklyDemand(
  jobs: MaintenanceJob[],
  corridorId: string,
  weekStart: string,
  weekEnd: string
): number {
  // For jobs with a preferredDate in this week range, use their duration as demand
  // For jobs without a preference, distribute across weeks proportionally
  const ws = new Date(weekStart).getTime();
  const we = new Date(weekEnd).getTime();

  let demand = 0;
  for (const job of jobs) {
    if (job.corridorId !== corridorId) continue;
    if (job.status !== 'open' && job.status !== 'assessed') continue;

    if (job.preferredDate) {
      const pd = new Date(job.preferredDate).getTime();
      if (pd >= ws && pd <= we) {
        demand += job.estimatedBlockHours;
      }
    } else {
      // Distribute unpreferred jobs evenly across 4 weeks
      demand += job.estimatedBlockHours / 4;
    }
  }
  return Math.round(demand * 10) / 10;
}

// How many candidate window hours exist on a corridor (from existing windows, scale to month)
function getCorridorWindowCapacity(
  windows: CandidateWindow[],
  corridorId: string
): number {
  const total = windows
    .filter(w => w.corridorId === corridorId)
    .reduce((sum, w) => sum + w.durationHours, 0);
  // Scale daily windows to weekly (daily windows * 7 days)
  return Math.round(total * 7 * 10) / 10;
}

// How many proposed block hours exist on a corridor for a given week
function getCorridorProposedHours(
  assignments: BlockAssignment[],
  jobs: MaintenanceJob[],
  corridorId: string
): number {
  return assignments
    .filter(a => a.corridorId === corridorId)
    .reduce((sum, a) => sum + a.durationHours, 0);
}

function UtilBar({ pct, demand, capacity }: { pct: number; demand: number; capacity: number }) {
  const clampedPct = Math.min(pct, 100);
  const isHigh = pct > 80;
  const isMedium = pct > 50;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-slate-500 mb-1">
        <span>Demand {demand}h</span>
        <span>Capacity ~{capacity}h</span>
      </div>
      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            isHigh ? 'bg-rose-500' : isMedium ? 'bg-amber-400' : 'bg-emerald-500'
          )}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
      <p className={clsx(
        'text-[10px] font-semibold mt-0.5',
        isHigh ? 'text-rose-600' : isMedium ? 'text-amber-600' : 'text-emerald-600'
      )}>
        {Math.round(pct)}% utilization
      </p>
    </div>
  );
}

export function MonthlyPlan() {
  const { corridors, jobs, candidateWindows, proposedPlan } = useAppStore();

  const assignments = proposedPlan?.assignments ?? [];
  const scheduledJobIds = new Set(assignments.flatMap(a => a.jobs));
  const scheduledJobs = jobs.filter(j => scheduledJobIds.has(j.id));
  const unscheduledJobs = jobs.filter(j => !scheduledJobIds.has(j.id) && j.status === 'open');

  const criticalUnscheduled = unscheduledJobs.filter(j => j.severity === 'A').length;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div>
          <h3 className="font-bold text-slate-800">Monthly Plan — September 2026</h3>
          <p className="text-xs text-slate-500 mt-0.5">Demo scenario · Demand vs. candidate corridor capacity</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2 bg-emerald-500 rounded-sm" />
            <span className="text-slate-600">&lt; 50%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2 bg-amber-400 rounded-sm" />
            <span className="text-slate-600">50–80%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2 bg-rose-500 rounded-sm" />
            <span className="text-slate-600">&gt; 80%</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 font-semibold text-slate-600 w-44">Corridor</th>
              {WEEKS.map(w => (
                <th key={w.label} className="text-center px-3 py-3 font-semibold text-slate-600">
                  <div>{w.label}</div>
                  <div className="text-[10px] font-normal text-slate-400">{w.start.slice(5)} – {w.end.slice(5)}</div>
                </th>
              ))}
              <th className="text-center px-3 py-3 font-semibold text-slate-600 w-32">Total Demand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {corridors.map(corridor => {
              const weeklyData = WEEKS.map(w => {
                const demand = getCorridorWeeklyDemand(jobs, corridor.id, w.start, w.end);
                const capacity = getCorridorWindowCapacity(candidateWindows, corridor.id);
                const pct = capacity > 0 ? (demand / capacity) * 100 : 0;
                const proposed = getCorridorProposedHours(assignments, jobs, corridor.id);
                return { demand, capacity, pct, proposed };
              });
              const totalDemand = weeklyData.reduce((s, d) => s + d.demand, 0);
              const avgCapacity = weeklyData[0]?.capacity ?? 0;
              const totalPct = avgCapacity > 0 ? (totalDemand / avgCapacity) * 100 : 0;

              return (
                <tr key={corridor.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{corridor.id}</div>
                    <div className="text-xs text-slate-500">{corridor.name}</div>
                  </td>
                  {weeklyData.map((d, i) => (
                    <td key={i} className="px-3 py-3 align-top">
                      {d.demand > 0 ? (
                        <div>
                          <UtilBar pct={d.pct} demand={d.demand} capacity={d.capacity} />
                          {d.proposed > 0 && i === 0 && (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-sky-600 font-medium">
                              <CheckCircle2 className="h-3 w-3" />
                              {d.proposed}h proposed
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-center align-top">
                    <p className="text-base font-bold text-slate-800">{Math.round(totalDemand * 10) / 10}h</p>
                    <p className={clsx(
                      'text-xs font-semibold mt-0.5',
                      totalPct > 80 ? 'text-rose-600' : totalPct > 50 ? 'text-amber-600' : 'text-emerald-600'
                    )}>
                      {Math.round(totalPct)}% avg util.
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary cards */}
      <div className="p-4 border-t border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50">
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
          <p className="text-xl font-bold text-slate-900">{jobs.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Total jobs in queue</p>
        </div>

        <div className="bg-white border border-emerald-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="text-xl font-bold text-emerald-700">{scheduledJobs.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Scheduled / proposed</p>
        </div>

        <div className="bg-white border border-amber-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="text-xl font-bold text-amber-700">{unscheduledJobs.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Unscheduled (backlog)</p>
        </div>

        <div className="bg-white border border-rose-200 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <p className="text-xl font-bold text-rose-700">{criticalUnscheduled}</p>
          <p className="text-xs text-slate-500 mt-0.5">Critical unscheduled</p>
        </div>
      </div>

      {/* Per-week breakdown panel */}
      <div className="p-4 border-t border-slate-200">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
          Weekly Breakdown — Jobs with Preferred Dates
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {WEEKS.map(week => {
            const weekJobs = jobs.filter(j => {
              if (!j.preferredDate) return false;
              const pd = new Date(j.preferredDate).getTime();
              return pd >= new Date(week.start).getTime() && pd <= new Date(week.end).getTime();
            });
            const critical = weekJobs.filter(j => j.severity === 'A');
            const medium = weekJobs.filter(j => j.severity === 'B');
            const low = weekJobs.filter(j => j.severity === 'C');
            const totalHours = weekJobs.reduce((s, j) => s + j.estimatedBlockHours, 0);

            return (
              <div key={week.label} className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs font-bold text-slate-700">{week.label}</p>
                    <p className="text-[10px] text-slate-400">{week.start.slice(5)} – {week.end.slice(5)}</p>
                  </div>
                  <span className="text-sm font-bold text-slate-800">{Math.round(totalHours * 10) / 10}h</span>
                </div>

                {weekJobs.length === 0 ? (
                  <p className="text-xs text-slate-400">No preferred requests</p>
                ) : (
                  <div className="space-y-1.5 mt-2">
                    {critical.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs text-rose-600 font-semibold">
                          <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" />
                          Sev A
                        </span>
                        <span className="text-xs font-bold text-rose-700">{critical.length} jobs</span>
                      </div>
                    )}
                    {medium.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold">
                          <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                          Sev B
                        </span>
                        <span className="text-xs font-bold text-amber-700">{medium.length} jobs</span>
                      </div>
                    )}
                    {low.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                          Sev C
                        </span>
                        <span className="text-xs font-bold text-emerald-700">{low.length} jobs</span>
                      </div>
                    )}
                    <div className="pt-1 border-t border-slate-100 flex items-center gap-1 text-[10px] text-slate-400">
                      <TrendingUp className="h-3 w-3" />
                      {weekJobs.length} requests, {corridors.filter(c =>
                        weekJobs.some(j => j.corridorId === c.id)
                      ).length} corridors
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 pb-3 text-[10px] text-slate-400">
        Demo scenario — utilization calculated from synthetic job demand vs. candidate windows derived from demo timetable. Not official railway data.
      </div>
    </div>
  );
}
