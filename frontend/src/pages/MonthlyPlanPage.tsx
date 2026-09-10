import { useState, useMemo } from 'react';
import { monthlyPlanService } from '../services/monthlyPlanService';
import type { MonthlyJob, MonthlyClassification, TargetWeek } from '../types/monthlyPlan';
import {
  AlertTriangle, AlertCircle, Info, RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, Clock, Users, TrendingUp, ArrowDown, Shield, Zap, X
} from 'lucide-react';
import clsx from 'clsx';

// ── Helpers ─────────────────────────────────────────────────────────────────
const SEV_BADGE: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-800 border border-rose-300',
  HIGH:     'bg-amber-100 text-amber-800 border border-amber-300',
  MEDIUM:   'bg-blue-100 text-blue-800 border border-blue-300',
  LOW:      'bg-slate-100 text-slate-600 border border-slate-300',
};
const DEPT_BADGE: Record<string, string> = {
  ENGG: 'bg-sky-100 text-sky-800',
  TRD:  'bg-amber-100 text-amber-800',
  'S&T':'bg-emerald-100 text-emerald-800',
};
const CLASS_BADGE: Record<MonthlyClassification, string> = {
  TARGET:  'bg-emerald-100 text-emerald-800 border border-emerald-300',
  PREPARE: 'bg-blue-100 text-blue-800 border border-blue-300',
  DEFER:   'bg-slate-100 text-slate-600 border border-slate-300',
  REVIEW:  'bg-amber-100 text-amber-800 border border-amber-300',
};
const CLASS_LABEL: Record<MonthlyClassification, string> = {
  TARGET:  'Target this month',
  PREPARE: 'Prepare for next month',
  DEFER:   'Defer',
  REVIEW:  'Needs manual review',
};
const WEEK_COLORS: Record<number, string> = {
  1: 'bg-rose-500',
  2: 'bg-amber-500',
  3: 'bg-sky-500',
  4: 'bg-emerald-500',
};

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide', cls)}>{text}</span>;
}

// ── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, border }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; border: string;
}) {
  return (
    <div className={clsx('bg-white rounded-xl border shadow-sm p-4', border)}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
        <div className="text-slate-400">{icon}</div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Priority Breakdown Pill ──────────────────────────────────────────────────
function PriorityBreakdown({ job }: { job: MonthlyJob }) {
  const maxAbsPoints = Math.max(...job.priorityBreakdown.map(f => Math.abs(f.points)), 1);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 font-mono text-[11px] shadow-sm text-slate-800 my-3 w-full">
      <div className="text-center mb-6 font-semibold tracking-wide text-sm text-slate-700">
        SHAP contribution
      </div>
      <div className="space-y-3">
        {job.priorityBreakdown.map((f, i) => {
          const isNegative = f.points < 0;
          // Scale to max width of the container area (approx 100%)
          const widthPct = (Math.abs(f.points) / Math.max(30, maxAbsPoints)) * 100;
          
          return (
            <div key={i} className="flex items-center">
              <span className="w-36 truncate shrink-0 text-slate-600" title={f.factor}>
                {f.factor}
              </span>
              <span className={clsx("w-10 text-right tabular-nums pr-3 font-semibold", isNegative ? "text-rose-600" : "text-sky-700")}>
                {isNegative ? '' : '+'}{f.points}
              </span>
              <div className="flex-1 flex items-center h-4">
                <div 
                  className={clsx("h-full rounded-sm", isNegative ? "bg-rose-400" : "bg-sky-400")}
                  style={{ width: `${Math.min(widthPct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-6 text-center flex flex-col items-center justify-center gap-1">
        <div className="w-6 h-px bg-slate-300 mb-1"></div>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <span className="text-slate-400 font-normal">→</span> 
          {job.classification === 'TARGET' ? 'High priority' : job.classification === 'PREPARE' ? 'Medium priority' : 'Low priority'}
        </div>
      </div>
    </div>
  );
}

// ── Controller Action Modal ──────────────────────────────────────────────────
function ControllerModal({
  job, onSave, onClose
}: {
  job: MonthlyJob;
  onSave: (id: string, cls: MonthlyClassification, week: TargetWeek | null, note: string) => void;
  onClose: () => void;
}) {
  const [cls, setCls] = useState<MonthlyClassification>(job.controllerClassification ?? job.classification);
  const [week, setWeek] = useState<TargetWeek | null>(job.controllerTargetWeek ?? job.targetWeek);
  const [note, setNote] = useState(job.controllerNote ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-5 py-4 bg-slate-900 text-white flex justify-between items-center">
          <div>
            <p className="font-bold">{job.id}</p>
            <p className="text-xs text-slate-400 mt-0.5">Controller Review Action</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Classification</label>
            <div className="grid grid-cols-2 gap-2">
              {(['TARGET', 'PREPARE', 'DEFER', 'REVIEW'] as MonthlyClassification[]).map(c => (
                <button key={c} onClick={() => setCls(c)}
                  className={clsx('py-2 text-xs font-semibold rounded-lg border-2 transition-all', cls === c ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400')}>
                  {CLASS_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Target Week</label>
            <div className="flex gap-2">
              {([1, 2, 3, 4] as TargetWeek[]).map(w => (
                <button key={w} onClick={() => setWeek(w === week ? null : w)}
                  className={clsx('flex-1 py-2 text-sm font-bold rounded-lg border-2 transition-all', week === w ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400')}>
                  W{w}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Tentative — confirmed during 2-week operational planning.</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">Controller Note</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none h-20"
              placeholder="Reason for change, resource note…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50">Cancel</button>
            <button onClick={() => { onSave(job.id, cls, week, note); onClose(); }}
              className="flex-1 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800">
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export function MonthlyPlanPage() {
  const [jobs, setJobs] = useState<MonthlyJob[]>(() => monthlyPlanService.buildPlan());
  const [activeTab, setActiveTab] = useState<'overview' | 'targets' | 'corridors' | 'calendar'>('overview');
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterClass, setFilterClass] = useState('ALL');
  const [filterCorridor, setFilterCorridor] = useState('ALL');
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<MonthlyJob | null>(null);

  const summary = useMemo(() => monthlyPlanService.buildSummary([...jobs]), [jobs]);

  const filteredJobs = useMemo(() => jobs.filter(j => {
    if (filterDept !== 'ALL' && j.department !== filterDept) return false;
    if (filterClass !== 'ALL' && j.classification !== filterClass) return false;
    if (filterCorridor !== 'ALL' && j.corridorId !== filterCorridor) return false;
    return true;
  }), [jobs, filterDept, filterClass, filterCorridor]);

  function handleRecalculate() {
    setJobs(prev => monthlyPlanService.recalculate([...prev]));
  }

  function handleControllerSave(id: string, cls: MonthlyClassification, week: TargetWeek | null, note: string) {
    setJobs(prev => prev.map(j => {
      if (j.id !== id) return j;
      const log = [...j.actionLog, {
        timestamp: new Date().toISOString(),
        field: 'classification/week',
        oldValue: `${j.classification} W${j.targetWeek}`,
        newValue: `${cls} W${week}`,
        reason: note || 'Controller override',
      }];
      return { ...j, controllerClassification: cls, controllerTargetWeek: week, controllerNote: note, classification: cls, targetWeek: week, actionLog: log };
    }));
  }

  const WEEKS = [
    { num: 1, label: 'Week 1', range: '01–07 Sep' },
    { num: 2, label: 'Week 2', range: '08–14 Sep' },
    { num: 3, label: 'Week 3', range: '15–21 Sep' },
    { num: 4, label: 'Week 4', range: '22–30 Sep' },
  ];
  const DEPTS = ['ENGG', 'TRD', 'S&T'];
  const CORRIDORS = ['COR-A-B', 'COR-B-C', 'COR-B-D'];

  return (
    <>
      {editingJob && (
        <ControllerModal job={editingJob} onSave={handleControllerSave} onClose={() => setEditingJob(null)} />
      )}

      <div className="space-y-5">
        {/* ── Banner ─────────────────────────────────────────────── */}
        <div className="bg-slate-900 rounded-xl px-6 py-4 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="h-5 w-5 text-sky-400" />
                <span className="text-xs font-semibold uppercase tracking-widest text-sky-400">Strategic Planning Layer</span>
              </div>
              <h1 className="text-xl font-bold tracking-wide">Monthly Maintenance Target Plan</h1>
              <p className="text-slate-400 text-sm mt-1">
                September 2026 · Demo Scenario
              </p>
              <p className="text-slate-300 text-xs mt-2 max-w-2xl">
                Provides strategic maintenance targets for the month. Exact block timings are determined later
                through the rolling 2-week operational planning process when reliable timetable and traffic data becomes available.
              </p>
            </div>
            <button
              onClick={handleRecalculate}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-semibold shrink-0 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Recalculate Plan
            </button>
          </div>
        </div>

        {/* ── Alerts ─────────────────────────────────────────────── */}
        {summary.alerts.length > 0 && (
          <div className="space-y-2">
            {summary.alerts.map(a => (
              <div key={a.id} className={clsx(
                'flex items-start gap-3 px-4 py-3 rounded-xl border text-sm',
                a.type === 'CRITICAL' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                a.type === 'WARNING'  ? 'bg-amber-50 border-amber-200 text-amber-800' :
                'bg-blue-50 border-blue-200 text-blue-800'
              )}>
                {a.type === 'CRITICAL' ? <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> :
                 a.type === 'WARNING'  ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> :
                 <Info className="h-4 w-4 shrink-0 mt-0.5" />}
                {a.message}
              </div>
            ))}
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard label="Total Backlog" value={summary.totalBacklog} icon={<TrendingUp className="h-4 w-4" />} border="border-slate-200" />
          <KpiCard label="Critical" value={summary.criticalJobs} icon={<AlertCircle className="h-4 w-4 text-rose-500" />} border="border-rose-200" />
          <KpiCard label="Overdue" value={summary.overdueJobs} icon={<Clock className="h-4 w-4 text-amber-500" />} border="border-amber-200" sub="Requires priority" />
          <KpiCard label="Targeted" value={summary.targetedThisMonth} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} border="border-emerald-200" sub="This month" />
          <KpiCard label="Est. Workload" value={`${summary.estimatedWorkloadHours}h`} icon={<Zap className="h-4 w-4" />} border="border-slate-200" />
          <KpiCard label="Est. Capacity" value={`${summary.estimatedCapacityHours}h`} icon={<TrendingUp className="h-4 w-4" />} border="border-slate-200" sub="Historical avg" />
          <KpiCard label="Utilization" value={`${summary.utilizationPct}%`} icon={<TrendingUp className="h-4 w-4 text-sky-500" />} border={summary.utilizationPct > 100 ? 'border-rose-300' : 'border-slate-200'} />
          <KpiCard label="Coord. Opps." value={summary.coordinationOpportunities} icon={<Users className="h-4 w-4 text-violet-500" />} border="border-violet-200" sub="Multi-dept" />
        </div>

        {/* ── Dept Capacity Bars ─────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          {summary.deptCapacities.map(dc => (
            <div key={dc.department} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <span className={clsx('text-xs font-bold px-2 py-0.5 rounded', DEPT_BADGE[dc.department])}>{dc.department}</span>
                <span className={clsx('text-xs font-semibold', dc.overloaded ? 'text-rose-600' : 'text-slate-600')}>
                  {dc.estimatedWorkloadHours}h / {dc.estimatedCapacityHours}h
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={clsx('h-full rounded-full transition-all', dc.overloaded ? 'bg-rose-500' : dc.utilizationPct > 80 ? 'bg-amber-400' : 'bg-emerald-500')}
                  style={{ width: `${Math.min(dc.utilizationPct, 100)}%` }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-slate-400">0h</span>
                <span className={clsx('text-[10px] font-semibold', dc.overloaded ? 'text-rose-600' : 'text-slate-500')}>
                  {dc.utilizationPct}% {dc.overloaded ? '⚠ Overloaded' : ''}
                </span>
                <span className="text-[10px] text-slate-400">{dc.estimatedCapacityHours}h</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tab Bar ─────────────────────────────────────────────── */}
        <div className="flex gap-1 border-b border-slate-200">
          {([
            { id: 'overview',  label: 'Overview & Flow' },
            { id: 'targets',   label: 'Monthly Targets' },
            { id: 'corridors', label: 'Corridor Groups' },
            { id: 'calendar',  label: 'Weekly Calendar' },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={clsx('px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
                activeTab === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* TAB: OVERVIEW                                          */}
        {/* ═══════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Planning vs 2-week distinction */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-900 text-white rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-sky-600 flex items-center justify-center">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">Monthly Plan</p>
                    <p className="text-xs text-slate-400">Strategic / Tactical</p>
                  </div>
                </div>
                <p className="text-xs text-slate-300 mb-3">Answers: <em>"What should we target this month?"</em></p>
                <ul className="space-y-1.5 text-xs text-slate-400">
                  {['Prioritised backlog list','Monthly targets','Tentative target week','Expected resource needs','Corridor grouping','Coordination opportunities'].map(i => (
                    <li key={i} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />{i}</li>
                  ))}
                </ul>
                <div className="mt-4 px-3 py-2 bg-amber-900/40 border border-amber-700 rounded-lg text-xs text-amber-300">
                  ⚠ NOT a confirmed block schedule.
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-bold text-sm text-slate-800">2-Week Rolling Plan</p>
                    <p className="text-xs text-slate-400">Executable / Operational</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-3">Answers: <em>"When can we actually do it?"</em></p>
                <ul className="space-y-1.5 text-xs text-slate-500">
                  {['Exact date & start/end time','Current timetable + traffic','Actual available block windows','Confirmed resources','CP-SAT optimized schedule','Controller approved → BDMS'].map(i => (
                    <li key={i} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />{i}</li>
                  ))}
                </ul>
                <div className="mt-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
                  ✓ Available approximately 2 weeks before execution.
                </div>
              </div>
            </div>

            {/* Architecture flow */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">Planning Architecture Flow</h3>
              <div className="flex flex-wrap items-center gap-1 text-xs font-medium">
                {[
                  { label: 'TMS / SMMS / TDMS', cls: 'bg-slate-100 text-slate-700' },
                  null,
                  { label: 'Data Validation', cls: 'bg-slate-100 text-slate-700' },
                  null,
                  { label: 'Priority Engine', cls: 'bg-sky-100 text-sky-800' },
                  null,
                  { label: 'Backlog Analysis', cls: 'bg-sky-100 text-sky-800' },
                  null,
                  { label: 'Corridor Grouping', cls: 'bg-violet-100 text-violet-800' },
                  null,
                  { label: 'Capacity Estimation', cls: 'bg-violet-100 text-violet-800' },
                  null,
                  { label: 'Monthly Target Selection', cls: 'bg-emerald-100 text-emerald-800 font-bold' },
                  null,
                  { label: 'Tentative Week Assignment', cls: 'bg-emerald-100 text-emerald-800' },
                  null,
                  { label: 'Controller Review ✓', cls: 'bg-amber-100 text-amber-800 font-bold' },
                  null,
                  { label: 'Approved Monthly Targets', cls: 'bg-amber-100 text-amber-800' },
                  null,
                  { label: '→ 2-Week Operational Planning', cls: 'bg-slate-900 text-white' },
                  null,
                  { label: 'CP-SAT Optimizer', cls: 'bg-slate-900 text-white' },
                  null,
                  { label: 'BDMS', cls: 'bg-rose-100 text-rose-800 font-bold' },
                ].map((item, i) =>
                  item === null ? (
                    <ArrowDown key={i} className="h-3 w-3 text-slate-400 rotate-[-90deg]" />
                  ) : (
                    <span key={i} className={clsx('px-2.5 py-1.5 rounded-lg text-[11px]', item.cls)}>{item.label}</span>
                  )
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-4">
                Demo architecture. SANGAM does not claim direct BDMS integration. Controller approval is always required before any block enters BDMS.
              </p>
            </div>

            {/* Coordination opportunities */}
            {summary.coordinationGroups.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Users className="h-4 w-4 text-violet-600" />
                  Potential Multi-Department Coordination Opportunities
                </h3>
                <div className="space-y-3">
                  {summary.coordinationGroups.map(g => (
                    <div key={g.id} className="border border-violet-200 rounded-xl p-4 bg-violet-50">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-xs font-bold text-violet-800">{g.corridorId}</span>
                            {g.departments.map(d => (
                              <Badge key={d} text={d} cls={DEPT_BADGE[d]} />
                            ))}
                            <span className="text-xs text-violet-600">{g.totalEstimatedHours}h combined</span>
                          </div>
                          <p className="text-xs text-violet-700">{g.benefit}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {g.jobs.map(jid => (
                              <span key={jid} className="text-[10px] bg-white border border-violet-200 text-violet-700 px-2 py-0.5 rounded font-medium">{jid}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-violet-600 mt-3 italic">
                        Candidate for coordinated scheduling. Final feasibility must be verified during 2-week operational planning.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* TAB: MONTHLY TARGETS TABLE                             */}
        {/* ═══════════════════════════════════════════════════════ */}
        {activeTab === 'targets' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <select className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                <option value="ALL">All Departments</option>
                <option value="ENGG">ENGG</option>
                <option value="TRD">TRD</option>
                <option value="S&T">S&T</option>
              </select>
              <select className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={filterClass} onChange={e => setFilterClass(e.target.value)}>
                <option value="ALL">All Classifications</option>
                <option value="TARGET">Target this month</option>
                <option value="PREPARE">Prepare for next</option>
                <option value="DEFER">Defer</option>
                <option value="REVIEW">Needs review</option>
              </select>
              <select className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                value={filterCorridor} onChange={e => setFilterCorridor(e.target.value)}>
                <option value="ALL">All Corridors</option>
                {CORRIDORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="ml-auto text-xs text-slate-500 self-center">{filteredJobs.length} requests</span>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['ID','Dept','Asset','Corridor','Defect','Priority','Safety','Due','Overdue','Duration','Resources','Target Wk','Coord.','Action'].map(h => (
                      <th key={h} className="px-3 py-3 text-left font-semibold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredJobs.map(job => (
                    <>
                      <tr key={job.id}
                        className={clsx('hover:bg-slate-50 cursor-pointer transition-colors', expandedJob === job.id ? 'bg-slate-50' : '')}
                        onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                      >
                        <td className="px-3 py-3 font-semibold text-slate-900 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {expandedJob === job.id ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                            {job.id}
                            {job.controllerClassification && <span className="text-violet-600 text-[9px] font-bold ml-1">CTRL</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3"><Badge text={job.department} cls={DEPT_BADGE[job.department]} /></td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{job.assetId}</td>
                        <td className="px-3 py-3 text-slate-600">{job.corridorId}</td>
                        <td className="px-3 py-3 text-slate-700 max-w-[140px] truncate">{job.defectType}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-8 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-sky-500 rounded-full" style={{ width: `${job.priorityScore}%` }} />
                            </div>
                            <span className="font-bold text-slate-800">{job.priorityScore}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3"><Badge text={job.safetyCriticality} cls={SEV_BADGE[job.safetyCriticality]} /></td>
                        <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{job.dueDate.slice(5)}</td>
                        <td className="px-3 py-3">
                          {job.overdueDays > 0 ? <span className="text-rose-700 font-bold">{job.overdueDays}d</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3 text-slate-600">{job.estimatedDurationHours}h</td>
                        <td className="px-3 py-3 text-slate-500 max-w-[120px] truncate">{job.requiredResources.join(', ')}</td>
                        <td className="px-3 py-3">
                          {job.targetWeek ? (
                            <span className={clsx('px-2 py-1 rounded text-[10px] font-bold text-white', WEEK_COLORS[job.targetWeek])}>
                              Week {job.targetWeek}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {job.coordinationGroupId
                            ? <span className="text-violet-700 font-semibold">Yes</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={e => { e.stopPropagation(); setEditingJob(job); }}
                            className="px-2 py-1 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors whitespace-nowrap">
                            Review
                          </button>
                        </td>
                      </tr>
                      {expandedJob === job.id && (
                        <tr key={`${job.id}-exp`}>
                          <td colSpan={14} className="px-6 py-4 bg-slate-50 border-t border-slate-200">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Defect Description</p>
                                <p className="text-xs text-slate-700">{job.defectDescription}</p>
                                {job.controllerNote && (
                                  <div className="mt-3 px-3 py-2 bg-violet-50 border border-violet-200 rounded text-xs text-violet-800">
                                    <strong>Controller note:</strong> {job.controllerNote}
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Priority Score ({job.priorityScore}/100) — SHAP Value Breakdown</p>
                                <PriorityBreakdown job={job} />
                                <p className="text-[10px] text-slate-400 mt-2">SHAP (SHapley Additive exPlanations) explains the priority model's prediction.</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Classification</p>
                                <Badge text={CLASS_LABEL[job.classification]} cls={CLASS_BADGE[job.classification]} />
                                <p className="text-[10px] text-slate-500 mt-2">Target week: {job.targetWeek ? `Week ${job.targetWeek}` : 'Not assigned'}</p>
                                <p className="text-[10px] text-slate-400 italic mt-1">Tentative — subject to 2-week operational optimization.</p>
                                {job.actionLog.length > 0 && (
                                  <div className="mt-3">
                                    <p className="text-[10px] font-semibold text-slate-500 mb-1">Controller Actions</p>
                                    {job.actionLog.slice(-2).map((a, i) => (
                                      <div key={i} className="text-[10px] text-slate-500 border-l-2 border-violet-300 pl-2 mb-1">
                                        {a.timestamp.slice(11, 16)}: {a.oldValue} → {a.newValue}
                                        {a.reason && ` · ${a.reason}`}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-slate-400">
              All data is synthetic demo data. Target weeks are tentative and will be refined using the rolling 2-week operational planning process.
            </p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* TAB: CORRIDOR GROUPS                                   */}
        {/* ═══════════════════════════════════════════════════════ */}
        {activeTab === 'corridors' && (
          <div className="space-y-5">
            {CORRIDORS.map(cor => {
              const corJobs = jobs.filter(j => j.corridorId === cor);
              if (corJobs.length === 0) return null;
              const deptGroups = DEPTS.map(d => ({
                dept: d as 'ENGG' | 'TRD' | 'S&T',
                jobs: corJobs.filter(j => j.department === d),
              })).filter(g => g.jobs.length > 0);
              const hasCoord = corJobs.some(j => j.coordinationGroupId);
              const totalHours = corJobs.reduce((s, j) => s + j.estimatedDurationHours, 0);

              return (
                <div key={cor} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
                    <div>
                      <h3 className="font-bold">{cor}</h3>
                      <p className="text-xs text-slate-400">{corJobs.length} requests · {Math.round(totalHours)}h estimated</p>
                    </div>
                    {hasCoord && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-800 rounded-lg text-xs font-semibold text-violet-200">
                        <Users className="h-3.5 w-3.5" />
                        Coordination opportunity
                      </div>
                    )}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {deptGroups.map(({ dept, jobs: deptJobs }) => (
                      <div key={dept} className="p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <Badge text={dept} cls={DEPT_BADGE[dept]} />
                          <span className="text-xs text-slate-500">{deptJobs.length} requests</span>
                          <span className="text-xs text-slate-400">{deptJobs.reduce((s, j) => s + j.estimatedDurationHours, 0)}h</span>
                        </div>
                        <div className="space-y-2">
                          {deptJobs.map(j => (
                            <div key={j.id} className="flex items-center gap-3 text-xs">
                              <span className="font-semibold text-slate-700 w-24 shrink-0">{j.id}</span>
                              <span className="text-slate-600 flex-1 truncate">{j.defectType}</span>
                              <Badge text={j.severity} cls={SEV_BADGE[j.severity]} />
                              <span className="text-slate-500">{j.estimatedDurationHours}h</span>
                              {j.targetWeek && (
                                <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold text-white', WEEK_COLORS[j.targetWeek])}>
                                  W{j.targetWeek}
                                </span>
                              )}
                              {j.coordinationGroupId && <Users className="h-3 w-3 text-violet-500 shrink-0" />}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {hasCoord && (
                    <div className="px-5 py-3 bg-violet-50 border-t border-violet-100 text-xs text-violet-800 flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Multiple departments have targeted work on {cor}. Potential coordinated scheduling candidate.
                        Final feasibility to be confirmed during 2-week planning.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* TAB: WEEKLY CALENDAR                                   */}
        {/* ═══════════════════════════════════════════════════════ */}
        {activeTab === 'calendar' && (
          <div className="space-y-4">
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>TENTATIVE MONTHLY TARGETS.</strong> Target weeks are indicative and will be refined using
                the rolling 2-week operational planning process. These are NOT confirmed block timings.
              </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold w-28">Department</th>
                    {WEEKS.map(w => (
                      <th key={w.num} className="px-4 py-3 text-center font-semibold">
                        <div>{w.label}</div>
                        <div className="text-xs text-slate-400 font-normal">{w.range}</div>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {DEPTS.map(dept => {
                    const deptJobs = jobs.filter(j => j.department === dept);
                    const weekCounts = WEEKS.map(w => deptJobs.filter(j => j.targetWeek === w.num));
                    const total = deptJobs.filter(j => j.targetWeek !== null).length;
                    return (
                      <tr key={dept} className="hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <Badge text={dept} cls={DEPT_BADGE[dept]} />
                        </td>
                        {weekCounts.map((wj, i) => (
                          <td key={i} className="px-4 py-4 text-center align-top">
                            {wj.length > 0 ? (
                              <div>
                                <div className="text-base font-bold text-slate-800 mb-1">{wj.length} jobs</div>
                                <div className="flex flex-col gap-0.5 items-center">
                                  {wj.some(j => j.severity === 'CRITICAL') && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-semibold">
                                      {wj.filter(j => j.severity === 'CRITICAL').length} critical
                                    </span>
                                  )}
                                  {wj.some(j => j.severity === 'HIGH') && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-semibold">
                                      {wj.filter(j => j.severity === 'HIGH').length} high
                                    </span>
                                  )}
                                  {wj.some(j => j.severity === 'MEDIUM' || j.severity === 'LOW') && (
                                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-semibold">
                                      {wj.filter(j => j.severity === 'MEDIUM' || j.severity === 'LOW').length} med/low
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-400 mt-0.5">
                                    {wj.reduce((s, j) => s + j.estimatedDurationHours, 0)}h est.
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-200">—</span>
                            )}
                          </td>
                        ))}
                        <td className="px-4 py-4 text-center font-bold text-slate-700">{total}</td>
                      </tr>
                    );
                  })}

                  {/* Total row */}
                  <tr className="bg-slate-50 border-t-2 border-slate-200">
                    <td className="px-4 py-3 font-bold text-slate-700">Total</td>
                    {WEEKS.map(w => {
                      const wTotal = jobs.filter(j => j.targetWeek === w.num).length;
                      const wHours = jobs.filter(j => j.targetWeek === w.num).reduce((s, j) => s + j.estimatedDurationHours, 0);
                      return (
                        <td key={w.num} className="px-4 py-3 text-center">
                          {wTotal > 0 ? (
                            <div>
                              <span className="font-bold text-slate-800">{wTotal} jobs</span>
                              <div className="text-[10px] text-slate-500">{Math.round(wHours)}h est.</div>
                            </div>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center font-bold text-slate-800">
                      {jobs.filter(j => j.targetWeek !== null).length}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-slate-400">
              Demo scenario — synthetic data. Target weeks are indicative only.
              The rolling 2-week planning process will confirm actual block availability and scheduling.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
