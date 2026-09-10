import { useState } from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Department, Severity, MaintenanceJob } from '../../types/domain';
import { useAppStore } from '../../store/useAppStore';
import clsx from 'clsx';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: (job: MaintenanceJob) => void;
}

const DEPT_SOURCE_MAP: Record<string, "TMS" | "SMMS" | "TDMS"> = {
  ENGG: 'TMS',
  TRD: 'TDMS',
  'S&T': 'SMMS',
};

const CORRIDORS = ['COR-A-B', 'COR-B-C', 'COR-B-D'];

const MAINTENANCE_TYPES: Record<string, string[]> = {
  ENGG: [
    'Track maintenance - Ballast cleaning',
    'Rail fracture repair',
    'Sleeper replacement',
    'Level crossing repair',
    'Ballast tamping',
  ],
  TRD: [
    'OHE wire adjustment',
    'Mast replacement',
    'OHE tension adjustment',
    'Pantograph contact wire check',
    'Bonding & earthing',
  ],
  'S&T': [
    'Signal aspect failure',
    'Point machine maintenance',
    'Cable testing',
    'Axle counter verification',
    'Level crossing gate equipment',
  ],
};

/** Add HH:mm duration to HH:mm start, returns HH:mm */
function addHours(start: string, hours: number): string {
  const [h, m] = start.split(':').map(Number);
  const totalMinutes = h * 60 + m + Math.round(hours * 60);
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

let requestCounter = 100; // Incrementing ID counter for user-submitted requests

export function NewRequestModal({ isOpen, onClose, onSubmitted }: Props) {
  const { corridors, addJob } = useAppStore();
  const corridorList = corridors.length > 0 ? corridors.map(c => c.id) : CORRIDORS;

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    department: '' as Department | '',
    corridorId: '',
    assetId: '',
    maintenanceType: '',
    severity: '' as Severity | '',
    detectedDate: today,
    dueDate: '',
    preferredDate: '',
    preferredStart: '10:00',
    estimatedDuration: 3,
    speedRestrictionActive: false,
    notes: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submittedJob, setSubmittedJob] = useState<MaintenanceJob | null>(null);

  const sourceSystem = form.department ? DEPT_SOURCE_MAP[form.department] : null;
  const maintenanceTypes = form.department ? (MAINTENANCE_TYPES[form.department] || []) : [];
  const preferredEnd = form.preferredStart && form.estimatedDuration
    ? addHours(form.preferredStart, form.estimatedDuration)
    : '';

  function validate() {
    const e: Record<string, string> = {};
    if (!form.department) e.department = 'Department is required.';
    if (!form.corridorId) e.corridorId = 'Corridor is required.';
    if (!form.assetId.trim()) e.assetId = 'Asset ID is required.';
    if (!form.maintenanceType) e.maintenanceType = 'Maintenance type is required.';
    if (!form.severity) e.severity = 'Severity is required.';
    if (!form.preferredDate) e.preferredDate = 'Preferred date is required.';
    if (form.estimatedDuration <= 0) e.estimatedDuration = 'Duration must be greater than 0.';
    if (form.dueDate && form.dueDate < form.detectedDate) {
      e.dueDate = 'Due date cannot be before detected date.';
    }
    if (form.preferredDate && form.preferredDate < form.detectedDate) {
      e.preferredDate = 'Preferred date cannot be before detected date.';
    }
    return e;
  }

  function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }

    const dept = form.department as Department;
    const deptPrefix = dept === 'S&T' ? 'SNT' : dept;
    requestCounter++;
    const id = `${deptPrefix}-REQ-${requestCounter}`;

    const job: MaintenanceJob = {
      id,
      sourceSystem: DEPT_SOURCE_MAP[dept],
      department: dept,
      assetId: form.assetId.trim(),
      corridorId: form.corridorId,
      defectType: form.maintenanceType,
      severity: form.severity as Severity,
      detectedDate: new Date(form.detectedDate).toISOString(),
      dueDate: form.dueDate
        ? new Date(form.dueDate).toISOString()
        : new Date(new Date(form.preferredDate).getTime() + 7 * 86400000).toISOString(),
      daysOverdue: 0,
      speedRestrictionActive: form.speedRestrictionActive,
      estimatedBlockHours: form.estimatedDuration,
      status: 'open',
      preferredDate: form.preferredDate,
      preferredStart: form.preferredStart,
      preferredEnd,
      notes: form.notes,
      fromRequest: true,
    };

    addJob(job);
    setSubmittedJob(job);
    setSubmitted(true);
    onSubmitted(job);
  }

  function handleClose() {
    setForm({
      department: '', corridorId: '', assetId: '', maintenanceType: '',
      severity: '', detectedDate: today, dueDate: '', preferredDate: '',
      preferredStart: '10:00', estimatedDuration: 3, speedRestrictionActive: false, notes: '',
    });
    setErrors({});
    setSubmitted(false);
    setSubmittedJob(null);
    onClose();
  }

  function field(label: string, err?: string, children?: React.ReactNode) {
    return (
      <div>
        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">{label}</label>
        {children}
        {err && <p className="text-xs text-rose-600 mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{err}</p>}
      </div>
    );
  }

  const inputCls = (err?: string) =>
    clsx('w-full px-3 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-shadow',
      err ? 'border-rose-400' : 'border-slate-300');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={handleClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-900 text-white shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-wide">New Maintenance Request</h2>
              <p className="text-xs text-slate-400 mt-1">Department Request → SANGAM Unified Queue</p>
            </div>
            <button onClick={handleClose} className="p-1.5 hover:bg-slate-700 rounded transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {submitted && submittedJob ? (
          /* Success screen */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mb-5">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Request Submitted</h3>
            <p className="text-sm text-slate-500 mb-6">Maintenance request added to the unified planning queue.</p>

            <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-5 text-left space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Request ID</span>
                <span className="font-semibold text-slate-900">{submittedJob.id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Department</span>
                <span className="font-semibold">{submittedJob.department} → {submittedJob.sourceSystem}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Corridor</span>
                <span className="font-semibold">{submittedJob.corridorId}</span>
              </div>
              {submittedJob.preferredDate && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Preferred Time</span>
                  <span className="font-semibold">{submittedJob.preferredDate} · {submittedJob.preferredStart}–{submittedJob.preferredEnd}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Status</span>
                <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs font-bold uppercase">Open</span>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-400 text-center">
              This is a demo request. No operational block has been created or approved.
            </div>

            <button
              onClick={handleClose}
              className="mt-6 w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold transition-colors"
            >
              View in Planning Queue
            </button>
          </div>
        ) : (
          /* Form */
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Department */}
            {field('Department *', errors.department,
              <select
                className={inputCls(errors.department)}
                value={form.department}
                onChange={e => setForm(f => ({ ...f, department: e.target.value as Department | '', maintenanceType: '' }))}
              >
                <option value="">Select department…</option>
                <option value="ENGG">ENGG — Engineering</option>
                <option value="TRD">TRD — Traction / OHE</option>
                <option value="S&T">S&amp;T — Signal &amp; Telecom</option>
              </select>
            )}

            {/* Source system auto-mapped */}
            {sourceSystem && (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                <div>
                  <p className="text-xs font-semibold text-blue-700">Source System</p>
                  <p className="text-sm font-bold text-blue-900">{sourceSystem}</p>
                </div>
                <span className="ml-auto text-xs text-blue-500 italic">Demo source mapping</span>
              </div>
            )}

            {/* Corridor */}
            {field('Corridor *', errors.corridorId,
              <select className={inputCls(errors.corridorId)} value={form.corridorId}
                onChange={e => setForm(f => ({ ...f, corridorId: e.target.value }))}>
                <option value="">Select corridor…</option>
                {corridorList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {/* Asset ID */}
            {field('Asset ID *', errors.assetId,
              <input
                className={inputCls(errors.assetId)}
                placeholder="e.g. TRK-A-091"
                value={form.assetId}
                onChange={e => setForm(f => ({ ...f, assetId: e.target.value }))}
              />
            )}

            {/* Maintenance Type */}
            {field('Maintenance / Defect Type *', errors.maintenanceType,
              <select className={inputCls(errors.maintenanceType)} value={form.maintenanceType}
                onChange={e => setForm(f => ({ ...f, maintenanceType: e.target.value }))}>
                <option value="">Select type…</option>
                {maintenanceTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}

            {/* Severity */}
            {field('Severity *', errors.severity,
              <div className="flex gap-2">
                {(['A', 'B', 'C'] as Severity[]).map(s => (
                  <button key={s} type="button"
                    onClick={() => setForm(f => ({ ...f, severity: s }))}
                    className={clsx(
                      'flex-1 py-2 text-sm font-bold rounded-lg border-2 transition-all',
                      form.severity === s
                        ? s === 'A' ? 'border-rose-500 bg-rose-500 text-white'
                          : s === 'B' ? 'border-amber-500 bg-amber-500 text-white'
                          : 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-400'
                    )}
                  >Severity {s}</button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {field('Detected Date', errors.detectedDate,
                <input type="date" className={inputCls(errors.detectedDate)} value={form.detectedDate}
                  onChange={e => setForm(f => ({ ...f, detectedDate: e.target.value }))} />
              )}
              {field('Due Date', errors.dueDate,
                <input type="date" className={inputCls(errors.dueDate)} value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              )}
            </div>

            {/* Preferred window */}
            <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Requested Maintenance Window</h4>

              {field('Preferred Date *', errors.preferredDate,
                <input type="date" className={inputCls(errors.preferredDate)} value={form.preferredDate}
                  onChange={e => setForm(f => ({ ...f, preferredDate: e.target.value }))} />
              )}

              <div className="grid grid-cols-2 gap-4">
                {field('Preferred Start',
                  undefined,
                  <input type="time" className={inputCls()} value={form.preferredStart}
                    onChange={e => setForm(f => ({ ...f, preferredStart: e.target.value }))} />
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Calculated End</label>
                  <div className="px-3 py-2 text-sm border border-dashed border-slate-300 rounded-lg bg-white text-slate-700 font-semibold">
                    {preferredEnd || '—'}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Calculated end time</p>
                </div>
              </div>

              {field('Estimated Duration (hours) *', errors.estimatedDuration,
                <input type="number" min={0.5} step={0.5} className={inputCls(errors.estimatedDuration)}
                  value={form.estimatedDuration}
                  onChange={e => setForm(f => ({ ...f, estimatedDuration: parseFloat(e.target.value) || 0 }))} />
              )}
            </div>

            {/* Speed restriction */}
            <div className="flex items-center justify-between py-3 border-y border-slate-200">
              <div>
                <p className="text-sm font-semibold text-slate-700">Speed Restriction Active</p>
                <p className="text-xs text-slate-500">Is there a current speed restriction on this asset?</p>
              </div>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, speedRestrictionActive: !f.speedRestrictionActive }))}
                className={clsx(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                  form.speedRestrictionActive ? 'bg-rail-accent' : 'bg-slate-300'
                )}
              >
                <span className={clsx(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                  form.speedRestrictionActive ? 'translate-x-6' : 'translate-x-1'
                )} />
              </button>
            </div>

            {/* Notes */}
            {field('Notes',
              undefined,
              <textarea
                className={clsx(inputCls(), 'resize-none h-20')}
                placeholder="Optional: coordination notes, location details…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            )}

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              This is a <strong>demo maintenance request</strong>. Submitting does not create or approve an operational railway block.
              Final feasibility requires railway-system validation.
            </div>
          </div>
        )}

        {/* Footer */}
        {!submitted && (
          <div className="px-6 py-4 border-t border-slate-200 bg-white shrink-0 flex gap-3">
            <button onClick={handleClose}
              className="flex-1 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit}
              className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition-colors">
              Submit Request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
