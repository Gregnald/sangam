import { useState } from 'react';
import { NetworkMap } from '../components/planner/NetworkMap';
import { Timeline } from '../components/planner/Timeline';
import { OptimizationPanel } from '../components/planner/OptimizationPanel';
import { MonthlyPlan } from '../components/planner/MonthlyPlan';
import clsx from 'clsx';

type PlanView = 'weekly' | 'monthly';

export function PlannerPage() {
  const [selectedCorridor, setSelectedCorridor] = useState<string | null>(null);
  const [planView, setPlanView] = useState<PlanView>('weekly');

  return (
    <div className="flex flex-col h-full space-y-5">
      {/* ── Header ── */}
      <div className="flex justify-between items-end shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Block Planner</h1>
          <p className="text-slate-500">Coordinate maintenance demand with timetable context.</p>
        </div>
        <div className="flex bg-slate-200 p-1 rounded-lg">
          <button
            onClick={() => setPlanView('weekly')}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
              planView === 'weekly'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            Weekly
          </button>
          <button
            onClick={() => setPlanView('monthly')}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
              planView === 'monthly'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            )}
          >
            Monthly
          </button>
        </div>
      </div>

      {planView === 'monthly' ? (
        /* ── Monthly View ── */
        <div className="flex flex-col flex-1 min-h-0 gap-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 shrink-0">
            {/* Optimization panel — still accessible in monthly view */}
            <div className="lg:col-span-1">
              <OptimizationPanel />
            </div>
            {/* Network map for context */}
            <div className="lg:col-span-2">
              <NetworkMap
                selectedCorridor={selectedCorridor}
                onSelectCorridor={(id) => setSelectedCorridor(id === selectedCorridor ? null : id)}
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <MonthlyPlan />
          </div>
        </div>
      ) : (
        /* ── Weekly View (existing) ── */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
          {/* Left Column */}
          <div className="lg:col-span-1 space-y-6 flex flex-col h-full overflow-y-auto pr-2">
            <OptimizationPanel />

            {selectedCorridor && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h3 className="font-bold text-slate-800 mb-2">Corridor Context</h3>
                <p className="text-sm text-slate-600 font-medium mb-4">{selectedCorridor}</p>
                <div className="text-xs text-slate-500 space-y-3">
                  <p>
                    <strong>Context:</strong> Train schedules derived from demo dataset indicate candidate maintenance windows.
                  </p>
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-800">
                    Operational feasibility requires validation against railway operating and signalling systems.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Map + Timeline */}
          <div className="lg:col-span-2 flex flex-col gap-6 h-full min-h-0">
            <div className="shrink-0">
              <NetworkMap
                selectedCorridor={selectedCorridor}
                onSelectCorridor={(id) => setSelectedCorridor(id === selectedCorridor ? null : id)}
              />
            </div>
            <div className="flex-1 min-h-0">
              <Timeline selectedCorridor={selectedCorridor} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
