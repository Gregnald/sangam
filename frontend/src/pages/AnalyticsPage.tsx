import { useAppStore } from "../store/useAppStore";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Info } from 'lucide-react';

export function AnalyticsPage() {
  const { baselinePlan, proposedPlan } = useAppStore();

  const baselineMetrics = baselinePlan?.metrics || {
    totalBlockGroups: 24, // Faking baseline for demo to show comparison
    totalBlockHours: 52,
    criticalJobsScheduled: 11,
    assetDowntimeHours: 52,
    corridorCapacityUtilization: 45
  };

  const proposedMetrics = proposedPlan?.metrics || {
    totalBlockGroups: 0,
    totalBlockHours: 0,
    criticalJobsScheduled: 0,
    assetDowntimeHours: 0,
    corridorCapacityUtilization: 0
  };

  const data = [
    {
      name: 'Block Groups',
      Baseline: baselineMetrics.totalBlockGroups,
      Proposed: proposedMetrics.totalBlockGroups,
    },
    {
      name: 'Block Hours',
      Baseline: baselineMetrics.totalBlockHours,
      Proposed: proposedMetrics.totalBlockHours,
    },
    {
      name: 'Critical Jobs',
      Baseline: baselineMetrics.criticalJobsScheduled,
      Proposed: proposedMetrics.criticalJobsScheduled,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics & Impact</h1>
          <p className="text-slate-500">Compare baseline scenario against the proposed optimized plan.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-semibold rounded border border-amber-200">
          <Info className="h-4 w-4" /> Simulated Scenario Metrics
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chart 1: Key Metrics Comparison */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-6">Plan Comparison (Absolute Values)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <Tooltip 
                  cursor={{fill: '#f1f5f9'}}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                <Bar dataKey="Baseline" fill="#94a3b8" radius={[4, 4, 0, 0]} maxBarSize={50} />
                <Bar dataKey="Proposed" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Efficiency / Capacity */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="font-bold text-slate-800 mb-6">Corridor Capacity Utilization (%)</h3>
          
          <div className="flex items-center justify-around h-72">
            <div className="flex flex-col items-center justify-end h-full w-24">
              <span className="mb-2 font-bold text-slate-600">{baselineMetrics.corridorCapacityUtilization.toFixed(0)}%</span>
              <div 
                className="w-full bg-slate-400 rounded-t-md transition-all duration-1000"
                style={{ height: `${baselineMetrics.corridorCapacityUtilization}%` }}
              ></div>
              <span className="mt-4 text-sm font-medium text-slate-500">Baseline</span>
            </div>

            <div className="flex flex-col items-center justify-end h-full w-24">
              <span className="mb-2 font-bold text-sky-600">{proposedMetrics.corridorCapacityUtilization.toFixed(0)}%</span>
              <div 
                className="w-full bg-sky-500 rounded-t-md transition-all duration-1000"
                style={{ height: `${proposedMetrics.corridorCapacityUtilization}%` }}
              ></div>
              <span className="mt-4 text-sm font-medium text-slate-500">Proposed</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-6">
          <h3 className="font-bold text-slate-800 mb-4">Metric Definitions (Demo)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div>
              <p className="font-semibold text-slate-700">Block Groups</p>
              <p className="text-slate-500 mt-1">Number of distinct coordinated maintenance block windows proposed across the network.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-700">Asset Downtime</p>
              <p className="text-slate-500 mt-1">Total hours where infrastructure assets are unavailable for operations due to maintenance.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-700">Capacity Utilization</p>
              <p className="text-slate-500 mt-1">Percentage of derived candidate windows actually utilized by the proposed plan.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
