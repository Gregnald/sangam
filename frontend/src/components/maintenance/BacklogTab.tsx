import { useAppStore } from '../../store/useAppStore';
import type { MaintenanceJob } from '../../types/domain';
import { Clock, AlertTriangle, ChevronRight, Info } from 'lucide-react';
import clsx from 'clsx';
import { format, parseISO } from 'date-fns';

const DEPT_COLORS: Record<string, string> = {
  ENGG: 'bg-sky-100 text-sky-700',
  TRD: 'bg-amber-100 text-amber-700',
  'S&T': 'bg-emerald-100 text-emerald-700',
  MULTI: 'bg-purple-100 text-purple-700',
};

const SEV_COLORS: Record<string, string> = {
  A: 'bg-rose-100 text-rose-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-emerald-100 text-emerald-700',
};

/** Returns true if the job's preferred window has NO candidate window that covers it */
function hasNoMatchingWindow(job: MaintenanceJob, candidateWindows: ReturnType<typeof useAppStore.getState>['candidateWindows']): boolean {
  if (!job.preferredDate || !job.preferredStart) return false; // no preference set, can't evaluate

  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const reqStartMin = toMin(job.preferredStart);
  const reqEndMin = reqStartMin + Math.round(job.estimatedBlockHours * 60);

  const corridorWindows = candidateWindows.filter(w => w.corridorId === job.corridorId);

  // Check if any candidate window on the same corridor on the preferred date
  // covers the requested start + duration
  return !corridorWindows.some(w => {
    const wStart = new Date(w.start);
    const wEnd = new Date(w.end);
    const wDate = wStart.toISOString().split('T')[0];
    if (wDate !== job.preferredDate) return false;
    const wStartMin = wStart.getHours() * 60 + wStart.getMinutes();
    const wEndMin = wEnd.getHours() * 60 + wEnd.getMinutes();
    // window must fully contain the requested period
    return wStartMin <= reqStartMin && wEndMin >= reqEndMin;
  });
}

interface JobRowProps {
  job: MaintenanceJob;
  reason: string;
  onClick: (job: MaintenanceJob) => void;
}

function JobRow({ job, reason, onClick }: JobRowProps) {
  return (
    <div
      onClick={() => onClick(job)}
      className="flex items-start gap-4 p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm cursor-pointer transition-all group"
    >
      <div className="shrink-0 mt-0.5">
        <span className={clsx('px-2 py-0.5 rounded text-xs font-bold', SEV_COLORS[job.severity])}>
          Sev. {job.severity}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-semibold text-slate-900 text-sm">{job.id}</span>
          <span className={clsx('text-xs px-2 py-0.5 rounded font-bold', DEPT_COLORS[job.department])}>
            {job.department}
          </span>
          <span className="text-xs text-slate-400">{job.sourceSystem}</span>
          <span className="text-xs text-slate-500">{job.corridorId}</span>
        </div>
        <p className="text-sm text-slate-600 truncate">{job.defectType}</p>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
            {reason}
          </span>
          {job.daysOverdue > 0 && (
            <span className="text-xs text-rose-600 font-semibold flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {job.daysOverdue}d overdue
            </span>
          )}
        </div>

        {job.preferredDate && job.preferredStart && (
          <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Requested: {job.preferredDate} · {job.preferredStart}–{job.preferredEnd}
            {' '}({job.estimatedBlockHours}h)
          </p>
        )}

        {job.dueDate && (
          <p className="mt-0.5 text-xs text-slate-400">
            Due: {format(parseISO(job.dueDate), 'MMM dd, yyyy')}
          </p>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400">{job.priorityScore ?? '—'}</span>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </div>
    </div>
  );
}

interface Props {
  onSelectJob: (job: MaintenanceJob) => void;
}

export function BacklogTab({ onSelectJob }: Props) {
  const { jobs, candidateWindows, proposedPlan } = useAppStore();

  // Get IDs already assigned in proposed plan
  const assignedJobIds = new Set(
    (proposedPlan?.assignments ?? []).flatMap(a => a.jobs)
  );

  // --- Section 1: Low-priority deferred jobs (Sev B or C, open, not assigned) ---
  const lowPriorityBacklog = jobs.filter(
    j => (j.severity === 'B' || j.severity === 'C') &&
      j.status === 'open' &&
      !assignedJobIds.has(j.id)
  ).sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  // --- Section 2: Jobs that have a preferred window but NO matching candidate window ---
  const windowUnavailableJobs = jobs.filter(
    j => j.preferredDate &&
      j.preferredStart &&
      j.status === 'open' &&
      !assignedJobIds.has(j.id) &&
      hasNoMatchingWindow(j, candidateWindows)
  ).sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

  const isEmpty = lowPriorityBacklog.length === 0 && windowUnavailableJobs.length === 0;

  return (
    <div className="space-y-8">
      {/* Explanation banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm">
        <Info className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-slate-700 mb-0.5">Maintenance Backlog — Demo Scenario</p>
          <p className="text-slate-500 text-xs">
            This view shows work that could not be included in the proposed plan:
            jobs deferred due to lower priority, and requests whose preferred time had no matching
            candidate corridor window. All data is synthetic.
          </p>
        </div>
      </div>

      {isEmpty && (
        <div className="py-16 text-center text-slate-400">
          <p className="text-lg font-semibold mb-1">No backlog items</p>
          <p className="text-sm">Run optimization to identify which jobs are deferred or have window conflicts.</p>
        </div>
      )}

      {/* ── Section 1: Low Priority / Deferred ── */}
      {lowPriorityBacklog.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Lower Priority — Pending Scheduling
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 font-semibold">
                  {lowPriorityBacklog.length}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Severity B &amp; C jobs that are open but not yet included in a proposed plan.
                Higher-priority (Sev A) jobs were scheduled first.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {lowPriorityBacklog.map(job => (
              <JobRow
                key={job.id}
                job={job}
                reason={`Priority ${job.priorityScore ?? '—'} · Sev ${job.severity} · Deferred`}
                onClick={onSelectJob}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Section 2: No Matching Window ── */}
      {windowUnavailableJobs.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-8 w-8 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
              <Clock className="h-4 w-4 text-rose-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Window Unavailable — Requested Time Not Feasible
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-rose-100 text-rose-700 font-semibold">
                  {windowUnavailableJobs.length}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                These requests have a preferred maintenance window, but no candidate corridor window was
                derived from the demo timetable that covers the requested time.
                Click a job to see planning context and alternative candidate windows.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {windowUnavailableJobs.map(job => (
              <JobRow
                key={job.id}
                job={job}
                reason="Preferred window: no matching candidate window found"
                onClick={onSelectJob}
              />
            ))}
          </div>

          <div className="mt-4 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
            <strong>Note:</strong> Candidate windows are derived from the demo timetable gap.
            No real COA or railway operational data is used. Final feasibility
            requires railway-system validation.
          </div>
        </div>
      )}

      {/* Summary footer */}
      {!isEmpty && (
        <div className="border-t border-slate-200 pt-5 grid grid-cols-3 gap-4 text-center">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-slate-900">{lowPriorityBacklog.length + windowUnavailableJobs.length}</p>
            <p className="text-xs text-slate-500 mt-1">Total backlog items</p>
          </div>
          <div className="bg-white border border-amber-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-amber-700">{lowPriorityBacklog.length}</p>
            <p className="text-xs text-slate-500 mt-1">Deferred (low priority)</p>
          </div>
          <div className="bg-white border border-rose-200 rounded-xl p-4">
            <p className="text-2xl font-bold text-rose-700">{windowUnavailableJobs.length}</p>
            <p className="text-xs text-slate-500 mt-1">Window unavailable</p>
          </div>
        </div>
      )}
    </div>
  );
}
