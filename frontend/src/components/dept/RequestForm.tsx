import { useEffect, useState } from "react";
import { api, qs } from "../../lib/api";
import { useAppStore } from "../../store/appStore";
import { useAuthStore } from "../../store/authStore";
import type { Asset, Corridor, Department } from "../../types/api";

const DEFECT_TYPES: Record<Department, string[]> = {
  ENGG: ["rail_fracture_risk", "track_geometry_twist", "weld_defect", "ballast_deficiency", "rail_wear"],
  SIGNAL: ["signal_relay_fault", "interlocking_fault", "cable_fault", "track_circuit_failure"],
  TRD: ["insulator_flashover_risk", "feeder_fault", "ohe_wire_wear", "traction_transformer_fault"],
};

export function RequestForm({ zone, onClose }: { zone: string | null; onClose: () => void }) {
  const role = useAuthStore((s) => s.role) as Department;
  const submitRequest = useAppStore((s) => s.submitRequest);

  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [corridorId, setCorridorId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [defectType, setDefectType] = useState(DEFECT_TYPES[role]?.[0] ?? "");
  const [severity, setSeverity] = useState<"A" | "B" | "C">("B");
  const [hours, setHours] = useState(3);
  const [dueDate, setDueDate] = useState("");
  const [speedRestriction, setSpeedRestriction] = useState(false);
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [result, setResult] = useState<{ outcome: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Corridor[]>(`/api/v1/corridors${qs({ zone: zone ?? undefined })}`).then(setCorridors);
  }, [zone]);

  useEffect(() => {
    if (!corridorId) {
      setAssets([]);
      return;
    }
    api.get<Asset[]>(`/api/v1/assets${qs({ corridorId, department: role })}`).then((rows) => {
      setAssets(rows);
      setAssetId(rows[0]?.assetId ?? "");
    });
  }, [corridorId, role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      let requestedWindowStart: string | undefined;
      let requestedWindowEnd: string | undefined;
      if (preferredDate && preferredTime) {
        // Local (IST) wall-clock time as the department typed it — a trailing "Z" would silently shift it by 5h30m.
        const start = new Date(`${preferredDate}T${preferredTime}:00`);
        const end = new Date(start.getTime() + hours * 3_600_000);
        requestedWindowStart = start.toISOString();
        requestedWindowEnd = end.toISOString();
      }
      const res = await submitRequest({
        corridorId,
        assetId,
        defectType,
        severityCode: severity,
        estimatedBlockHours: hours,
        dueDate,
        requestedWindowStart,
        requestedWindowEnd,
        speedRestrictionKmph: speedRestriction ? 20 : undefined,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const outcomeLabel: Record<string, string> = {
    scheduled: "Scheduled directly into this week's plan.",
    pending: "Added to the backlog — no capacity found yet this week. It will be reconsidered automatically.",
    reschedule_offered: "No capacity at the exact time you wanted. Check Actions Needed for an alternate window to accept.",
    preemption_pending: "This request qualifies to bump a lower-priority scheduled block. Sent to the controller for approval.",
  };

  if (result) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-ops-panel border border-ops-border p-6 w-full max-w-md">
          <h3 className="text-sm font-semibold text-ops-text mb-2">Request submitted</h3>
          <p className="text-xs text-ops-muted mb-4">{outcomeLabel[result.outcome] ?? result.outcome}</p>
          <button onClick={onClose} className="w-full py-2 bg-ops-accent text-white text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <form onSubmit={handleSubmit} className="bg-ops-panel border border-ops-border p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-sm font-semibold text-ops-text mb-4">New block request — {role}</h3>

        <label className="block text-xs text-ops-muted mb-1">Corridor</label>
        <select className="w-full mb-3 px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" value={corridorId} onChange={(e) => setCorridorId(e.target.value)} required>
          <option value="">Select corridor…</option>
          {corridors.map((c) => (
            <option key={c.corridorId} value={c.corridorId}>
              {c.lineName} ({c.trainCount} trains/day)
            </option>
          ))}
        </select>

        <label className="block text-xs text-ops-muted mb-1">Asset</label>
        <select className="w-full mb-3 px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" value={assetId} onChange={(e) => setAssetId(e.target.value)} required disabled={!corridorId}>
          <option value="">Select asset…</option>
          {assets.map((a) => (
            <option key={a.assetId} value={a.assetId}>
              {a.assetType} @ km {a.kmMarker}
            </option>
          ))}
        </select>

        <label className="block text-xs text-ops-muted mb-1">Defect / maintenance type</label>
        <select className="w-full mb-3 px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" value={defectType} onChange={(e) => setDefectType(e.target.value)}>
          {DEFECT_TYPES[role]?.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-ops-muted mb-1">Severity</label>
            <div className="flex gap-1">
              {(["A", "B", "C"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={`flex-1 py-1.5 text-xs font-semibold border ${severity === s ? "bg-ops-accent border-ops-accent text-white" : "border-ops-border text-ops-muted"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-ops-muted mb-1">Est. duration (hrs)</label>
            <input type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(parseFloat(e.target.value))} className="w-full px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" />
          </div>
        </div>

        <label className="block text-xs text-ops-muted mb-1">Due date</label>
        <input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full mb-3 px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-ops-muted mb-1">Preferred date (optional)</label>
            <input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} className="w-full px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" />
          </div>
          <div>
            <label className="block text-xs text-ops-muted mb-1">Preferred start (UTC)</label>
            <input type="time" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} className="w-full px-2 py-1.5 bg-black/20 border border-ops-border text-ops-text text-sm" />
          </div>
        </div>

        <label className="flex items-center gap-2 mb-4 text-xs text-ops-muted">
          <input type="checkbox" checked={speedRestriction} onChange={(e) => setSpeedRestriction(e.target.checked)} />
          Active speed restriction on this asset
        </label>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 border border-ops-border text-ops-muted text-sm">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !corridorId || !assetId} className="flex-1 py-2 bg-ops-accent disabled:opacity-50 text-white text-sm">
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </div>
  );
}
