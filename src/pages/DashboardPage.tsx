import { useAppStore } from "../store/useAppStore";
import { AlertCircle, Calendar, Wrench, CheckCircle2 } from 'lucide-react';

export function DashboardPage() {
  const { jobs, candidateWindows, proposedPlan } = useAppStore();

  const openJobs = jobs.filter(j => j.status === 'open');
  const criticalJobs = jobs.filter(j => j.severity === 'A');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
        <p className="text-slate-500">System status and planning summary.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3 text-slate-600 mb-2">
            <Wrench className="h-5 w-5" />
            <h3 className="font-semibold">Open Maintenance Jobs</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{openJobs.length}</p>
          <p className="text-xs text-slate-400 mt-2">Demo scenario</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3 text-rose-600 mb-2">
            <AlertCircle className="h-5 w-5" />
            <h3 className="font-semibold">Critical / High Priority</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{criticalJobs.length}</p>
          <p className="text-xs text-slate-400 mt-2">Severity A jobs</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3 text-emerald-600 mb-2">
            <Calendar className="h-5 w-5" />
            <h3 className="font-semibold">Candidate Windows</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{candidateWindows.length}</p>
          <p className="text-xs text-slate-400 mt-2">Derived from timetable gap</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-3 text-rail-accent mb-2">
            <CheckCircle2 className="h-5 w-5" />
            <h3 className="font-semibold">Proposed Block Groups</h3>
          </div>
          <p className="text-3xl font-bold text-slate-900">{proposedPlan?.assignments.length || 0}</p>
          <p className="text-xs text-slate-400 mt-2">Requires review</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Data & Integration Sources</h2>
          <div className="space-y-3">
            {[
              { name: 'TMS (Track)', status: 'SYNTHETIC' },
              { name: 'SMMS (S&T)', status: 'SYNTHETIC' },
              { name: 'TDMS (OHE)', status: 'SYNTHETIC' },
              { name: 'Timetable', status: 'DEMO DATASET' },
              { name: 'COA', status: 'PROXY' },
              { name: 'Railway Network', status: 'SCHEMATIC DEMO' }
            ].map((source, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="text-sm font-medium text-slate-700">{source.name}</span>
                <span className="text-xs font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded">
                  {source.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-bold text-slate-900 mb-4">Planning Status</h2>
          <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">Weekly Horizon: Aug 31 - Sep 06</h4>
            <p className="text-sm text-blue-800 mb-4">
              Maintenance demand is populated. Candidate windows derived from timetable. 
              Run optimization in the Block Planner to generate a proposed plan.
            </p>
            {proposedPlan ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                Draft Proposed Plan Ready for Review
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-700">
                No Plan Proposed Yet
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
