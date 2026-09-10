import type { MaintenanceJob } from '../../types/domain';
import { useAppStore } from '../../store/useAppStore';
import clsx from 'clsx';

interface Props {
  job: MaintenanceJob;
}

/** Two windows overlap if they share the same preferredDate and times overlap */
function timesOverlap(aStart: string, aDurH: number, bStart: string, bDurH: number): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const aS = toMin(aStart);
  const aE = aS + Math.round(aDurH * 60);
  const bS = toMin(bStart);
  const bE = bS + Math.round(bDurH * 60);
  return aS < bE && bS < aE; // standard interval overlap
}

const DEPT_COLORS: Record<string, string> = {
  ENGG: 'bg-sky-100 text-sky-700',
  TRD: 'bg-amber-100 text-amber-700',
  'S&T': 'bg-emerald-100 text-emerald-700',
};

export function RelatedRequestsSection({ job }: Props) {
  const { jobs, candidateWindows, schedules } = useAppStore();

  // Find jobs on the same corridor that have an overlapping preferred window
  const related = jobs.filter(j => {
    if (j.id === job.id) return false;
    if (j.corridorId !== job.corridorId) return false;
    // Both must have a preferredDate to compare
    if (!j.preferredDate || !job.preferredDate) return false;
    if (j.preferredDate !== job.preferredDate) return false;
    if (!j.preferredStart || !job.preferredStart) return false;
    return timesOverlap(job.preferredStart, job.estimatedBlockHours, j.preferredStart, j.estimatedBlockHours);
  });

  // Candidate windows for this corridor
  const corridorWindows = candidateWindows.filter(w => w.corridorId === job.corridorId);

  // Demo timetable context: trains on this corridor
  const corridorSchedules = schedules.filter(s => s.corridorId === job.corridorId);

  return (
    <div className="space-y-6">
      {/* REQUEST PERIOD */}
      {job.preferredDate && job.preferredStart && (
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Request Period</h3>
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-blue-900">
              {new Date(job.preferredDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <p className="text-sm text-blue-800 mt-0.5">
              {job.preferredStart} – {job.preferredEnd || '?'}
              <span className="ml-2 text-xs text-blue-600">({job.estimatedBlockHours}h requested)</span>
            </p>
            <p className="text-[10px] text-blue-500 mt-2">
              Requested maintenance period. Not an approved block.
            </p>
          </div>
          {job.notes && (
            <p className="mt-2 text-xs text-slate-600 italic border-l-2 border-slate-300 pl-3">{job.notes}</p>
          )}
        </div>
      )}

      {/* RELATED REQUESTS */}
      {related.length > 0 && (
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Related Requests</h3>
          <p className="text-xs text-slate-400 mb-3">Same corridor · overlapping preferred window</p>
          <div className="space-y-2">
            {related.map(r => (
              <div key={r.id} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <span className={clsx('px-2 py-0.5 rounded text-xs font-bold shrink-0', DEPT_COLORS[r.department])}>
                  {r.department}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{r.id}</p>
                  <p className="text-xs text-slate-500 truncate">{r.defectType}</p>
                  {r.preferredStart && (
                    <p className="text-xs text-slate-600 mt-0.5">
                      {r.preferredStart}–{r.preferredEnd} · {r.estimatedBlockHours}h · Sev. {r.severity}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-amber-600 text-base">⚡</span>
            <p className="text-xs text-amber-800 font-medium">
              Potential coordination opportunity.
              <span className="font-normal text-amber-700 ml-1">
                Requests not guaranteed compatible. Requires controller review.
              </span>
            </p>
          </div>
        </div>
      )}

      {/* PLANNING CONTEXT – Candidate Windows */}
      {corridorWindows.length > 0 && (
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Planning Context</h3>
          <p className="text-xs text-slate-400 mb-2">Candidate windows on {job.corridorId}</p>
          <div className="space-y-2">
            {corridorWindows.slice(0, 3).map(w => {
              const startTime = new Date(w.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
              const endTime = new Date(w.end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={w.id} className="flex items-center justify-between text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="text-slate-700 font-medium">{startTime} – {endTime}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">{w.durationHours.toFixed(1)}h</span>
                    <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded font-semibold uppercase text-[10px]">Candidate</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Candidate window derived from demo timetable gap. Final operational feasibility requires railway-system validation.
          </p>
        </div>
      )}

      {/* Demo Timetable Context */}
      {corridorSchedules.length > 0 && (
        <div className="border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Demo Timetable Context</h3>
          <div className="space-y-1.5">
            {corridorSchedules.map(s => {
              const startT = new Date(s.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
              const endT = new Date(s.end).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={s.id} className="flex items-center gap-3 text-xs text-slate-600 px-3 py-2 bg-rose-50/60 border border-rose-100 rounded-lg">
                  <span className="font-semibold text-rose-700">{s.trainId}</span>
                  <span>{startT} → {endT}</span>
                  <span className="ml-auto text-rose-500 text-[10px]">Train transit</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
