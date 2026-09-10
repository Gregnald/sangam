import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { MaintenanceJob } from '../types/domain';
import { X, Plus, ArrowDown, ArrowRight, ListChecks, Archive } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';
import { NewRequestModal } from '../components/maintenance/NewRequestModal';
import { RelatedRequestsSection } from '../components/maintenance/RelatedRequestsSection';
import { BacklogTab } from '../components/maintenance/BacklogTab';

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

export function MaintenancePage() {
  const { jobs, proposedPlan } = useAppStore();
  const [selectedJob, setSelectedJob] = useState<MaintenanceJob | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'backlog'>('queue');

  const filteredJobs = jobs.filter(j => filter === 'ALL' || j.department === filter);

  // KPI counts from actual dataset
  const engCount = jobs.filter(j => j.department === 'ENGG').length;
  const trdCount = jobs.filter(j => j.department === 'TRD').length;
  const sntCount = jobs.filter(j => j.department === 'S&T').length;

  // Backlog badge count (low-sev or window-unavailable, open, not assigned)
  const assignedJobIds = new Set((proposedPlan?.assignments ?? []).flatMap(a => a.jobs));
  const backlogCount = jobs.filter(
    j => j.status === 'open' && !assignedJobIds.has(j.id) &&
    (j.severity === 'B' || j.severity === 'C' || (j.fromRequest && j.preferredDate))
  ).length;

  function handleSubmitted(job: MaintenanceJob) {
    // Auto-select the newly submitted job in the drawer for immediate feedback
    setTimeout(() => setSelectedJob(job), 300);
  }

  return (
    <>
      <NewRequestModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmitted={handleSubmitted}
      />

      <div className="flex h-full -m-6 relative overflow-hidden">
        {/* Main content */}
        <div className={clsx('flex-1 p-6 transition-all overflow-y-auto', selectedJob ? 'mr-[420px]' : '')}>

          {/* ── Header ── */}
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Maintenance Workbench</h1>
              <p className="text-slate-500">Unified backlog from ENGG (TMS), TRD (TDMS), and S&amp;T (SMMS).</p>
            </div>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 shrink-0 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              New Maintenance Request
            </button>
          </div>

          {/* ── Demo Integration Flow ── */}
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Department Maintenance Demand</h2>
              <span className="text-[10px] text-slate-400 italic">Demo integration flow</span>
            </div>
            <div className="flex flex-col md:flex-row items-center gap-2 md:gap-0 text-center">
              {[
                { dept: 'ENGG', src: 'TMS', count: engCount, cls: 'bg-sky-50 border-sky-200 text-sky-800' },
                { dept: 'TRD', src: 'TDMS', count: trdCount, cls: 'bg-amber-50 border-amber-200 text-amber-800' },
                { dept: 'S&T', src: 'SMMS', count: sntCount, cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
              ].map((item, i) => (
                <div key={item.dept} className="flex items-center gap-2 md:gap-0">
                  {i > 0 && (
                    <div className="hidden md:flex items-center px-3 text-slate-400"><ArrowRight className="h-4 w-4 rotate-0" /></div>
                  )}
                  <div className={clsx('rounded-lg border px-4 py-3 w-36', item.cls)}>
                    <p className="text-xs font-bold uppercase">{item.dept}</p>
                    <p className="text-[10px] opacity-70">{item.src}</p>
                    <p className="text-lg font-bold mt-1">{item.count}</p>
                    <p className="text-[10px] opacity-70">requests</p>
                  </div>
                </div>
              ))}
              <div className="hidden md:flex items-center px-3 text-slate-400"><ArrowRight className="h-5 w-5" /></div>
              <div className="md:flex items-center gap-2 hidden">
                <ArrowDown className="h-4 w-4 text-slate-400 rotate-[-90deg] md:rotate-0 hidden md:block" />
              </div>
              <div className="flex flex-col items-center md:ml-3 gap-1.5">
                <div className="bg-slate-900 text-white rounded-lg px-5 py-3 text-center">
                  <p className="text-xs font-bold uppercase tracking-widest">SANGAM</p>
                  <p className="text-[10px] text-slate-400">Unified Queue</p>
                  <p className="text-lg font-bold mt-0.5">{jobs.length}</p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <ArrowDown className="h-3 w-3" />
                  <span>Priority + Planning</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── KPI row ── */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: 'ENGG', count: engCount, cls: 'border-sky-200' },
              { label: 'TRD', count: trdCount, cls: 'border-amber-200' },
              { label: 'S&T', count: sntCount, cls: 'border-emerald-200' },
              { label: 'Total', count: jobs.length, cls: 'border-slate-300 bg-slate-50' },
            ].map(k => (
              <div key={k.label} className={clsx('bg-white border rounded-lg px-4 py-3 text-center shadow-sm', k.cls)}>
                <p className="text-xs font-semibold text-slate-500">{k.label}</p>
                <p className="text-2xl font-bold text-slate-900">{k.count}</p>
                <p className="text-[10px] text-slate-400">Demo scenario</p>
              </div>
            ))}
          </div>

          {/* ── Tab Switcher ── */}
          <div className="mb-5 flex items-center gap-1 border-b border-slate-200">
            <button
              onClick={() => setActiveTab('queue')}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
                activeTab === 'queue'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <ListChecks className="h-4 w-4" />
              Planning Queue
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">{jobs.length}</span>
            </button>

            <button
              onClick={() => setActiveTab('backlog')}
              className={clsx(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
                activeTab === 'backlog'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <Archive className="h-4 w-4" />
              Backlog
              {backlogCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 font-semibold">
                  {backlogCount}
                </span>
              )}
            </button>
          </div>

          {activeTab === 'backlog' ? (
            <BacklogTab onSelectJob={(job) => setSelectedJob(job)} />
          ) : (
            <>
              {/* ── Dept Filters ── */}
              <div className="mb-4 flex gap-2">
                {['ALL', 'ENGG', 'TRD', 'S&T'].map(d => (
                  <button
                    key={d}
                    onClick={() => setFilter(d)}
                    className={clsx(
                      'px-4 py-2 text-sm font-medium rounded-lg border transition-colors',
                      filter === d
                        ? 'bg-rail-dark text-white border-rail-dark'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>


          {/* ── Table ── */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="p-3 pl-4">ID</th>
                  <th className="p-3">Dept</th>
                  <th className="p-3">Source</th>
                  <th className="p-3">Corridor</th>
                  <th className="p-3">Defect / Task</th>
                  <th className="p-3">Sev.</th>
                  <th className="p-3">Score</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400 text-sm">
                      No maintenance jobs match the selected filters.
                    </td>
                  </tr>
                )}
                {filteredJobs.map(job => (
                  <tr
                    key={job.id}
                    onClick={() => setSelectedJob(job)}
                    className={clsx(
                      'hover:bg-slate-50 cursor-pointer transition-colors',
                      selectedJob?.id === job.id ? 'bg-sky-50 border-l-2 border-l-sky-500' : ''
                    )}
                  >
                    <td className="p-3 pl-4 font-medium text-slate-900 whitespace-nowrap">
                      {job.id}
                      {job.fromRequest && (
                        <span className="ml-1.5 text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-semibold uppercase align-middle">
                          Request
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className={clsx('text-xs px-2 py-0.5 rounded font-bold', DEPT_COLORS[job.department])}>
                        {job.department}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-slate-500 font-medium">{job.sourceSystem}</td>
                    <td className="p-3 text-slate-600">{job.corridorId}</td>
                    <td className="p-3 text-slate-900 max-w-[180px] truncate">{job.defectType}</td>
                    <td className="p-3">
                      <span className={clsx('px-2 py-0.5 rounded text-xs font-bold', SEV_COLORS[job.severity])}>
                        {job.severity}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-700">{job.priorityScore ?? '—'}</td>
                    <td className="p-3 text-slate-600 capitalize text-xs">{job.status.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </>
          )}
        </div>

        {/* ── Detail Drawer ── */}
        <div className={clsx(
          'absolute top-0 right-0 h-full w-[420px] bg-white border-l border-slate-200 shadow-2xl transition-transform duration-300 overflow-y-auto',
          selectedJob ? 'translate-x-0' : 'translate-x-full'
        )}>
          {selectedJob && (
            <div className="p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={clsx('text-xs px-2 py-0.5 rounded font-bold', DEPT_COLORS[selectedJob.department])}>
                      {selectedJob.department}
                    </span>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold border border-blue-100">
                      {selectedJob.sourceSystem}
                    </span>
                    {selectedJob.fromRequest && (
                      <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-bold border border-violet-200">
                        Department Request
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">{selectedJob.id}</h2>
                </div>
                <button onClick={() => setSelectedJob(null)} className="p-1 hover:bg-slate-100 rounded shrink-0">
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Core details */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Details</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-500">Asset</p>
                      <p className="font-medium">{selectedJob.assetId}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Corridor</p>
                      <p className="font-medium">{selectedJob.corridorId}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-slate-500">Task</p>
                      <p className="font-medium">{selectedJob.defectType}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Est. Duration</p>
                      <p className="font-medium">{selectedJob.estimatedBlockHours}h</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Due Date</p>
                      <p className="font-medium">{format(parseISO(selectedJob.dueDate), 'MMM dd, yyyy')}</p>
                    </div>
                    {selectedJob.speedRestrictionActive && (
                      <div className="col-span-2">
                        <span className="text-xs bg-rose-100 text-rose-700 px-2 py-1 rounded font-semibold">
                          ⚠ Speed Restriction Active
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Priority */}
                <div className="border-t border-slate-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Priority Score — Demo</h3>
                    <span className="text-2xl font-bold text-rail-accent">
                      {selectedJob.priorityScore ?? '—'} <span className="text-sm text-slate-400 font-normal">/ 100</span>
                    </span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500 mb-1">Why is this prioritized?</p>
                    {selectedJob.priorityExplanation?.map((exp, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-700">{exp.factor}</span>
                        <span className="font-medium text-emerald-600">+{exp.score}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 p-3 bg-slate-50 rounded text-xs text-slate-500 border border-slate-200">
                    Demo Priority Engine — deterministic formula. Production: ML model (XGBoost / LightGBM).
                  </div>
                </div>

                {/* Related requests + planning context */}
                <RelatedRequestsSection job={selectedJob} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
