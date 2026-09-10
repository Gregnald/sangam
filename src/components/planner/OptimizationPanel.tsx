import { useState } from 'react';
import { useAppStore } from "../../store/useAppStore";
import { Play, Check, AlertTriangle } from 'lucide-react';

export function OptimizationPanel() {
  const { jobs, candidateWindows, runOptimization, proposedPlan } = useAppStore();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");

  const handleRunOptimization = () => {
    setIsRunning(true);
    setProgress(0);
    setProgressText("Preparing maintenance requests...");

    setTimeout(() => { setProgress(25); setProgressText("Checking candidate windows..."); }, 600);
    setTimeout(() => { setProgress(50); setProgressText("Applying constraints..."); }, 1200);
    setTimeout(() => { setProgress(75); setProgressText("Generating proposed plan..."); }, 1800);
    setTimeout(() => {
      runOptimization();
      setIsRunning(false);
      setProgress(100);
    }, 2400);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-800">Optimization Simulator</h3>
          <p className="text-xs text-slate-500">Deterministic demonstration</p>
        </div>
        <button 
          onClick={handleRunOptimization}
          disabled={isRunning}
          className="flex items-center gap-2 bg-rail-dark hover:bg-slate-800 disabled:bg-slate-400 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
        >
          {isRunning ? (
            <span className="flex h-4 w-4">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
            </span>
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
          Run Optimization
        </button>
      </div>

      {isRunning && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>{progressText}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div className="bg-rail-accent h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mt-6 border-t border-slate-100 pt-4">
        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">Inputs</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Open Jobs</span>
              <span className="font-medium text-slate-900">{jobs.filter(j=>j.status==='open').length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Candidate Windows</span>
              <span className="font-medium text-slate-900">{candidateWindows.length}</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">Outputs</h4>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Proposed Groups</span>
              <span className="font-medium text-rail-accent">{proposedPlan?.metrics.totalBlockGroups || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Critical Sched.</span>
              <span className="font-medium text-rose-600">{proposedPlan?.metrics.criticalJobsScheduled || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {proposedPlan && !isRunning && (
        <div className="mt-6 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-slate-800 text-sm">Controller Review Required</h4>
              <p className="text-xs text-slate-600 mt-1 mb-3">
                Optimization produced a simulated proposed plan. Final operational feasibility requires validation against railway operating systems.
              </p>
              <div className="flex gap-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium transition-colors">
                  <Check className="h-4 w-4" /> Approve Plan
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-medium transition-colors">
                  Edit / Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
