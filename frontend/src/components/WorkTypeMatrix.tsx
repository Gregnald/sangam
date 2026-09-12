import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

interface Cell {
  type_a: string;
  type_b: string;
  compatible: boolean;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}
interface Matrix {
  workTypes: { type: string; department: string }[];
  cells: Cell[];
  pairModel: { active: boolean; rows: number; reason?: string; cv_auc?: number };
}

const DEPT_COLOR: Record<string, string> = { ENGG: "#2563eb", SIGNAL: "#9333ea", TRD: "#ea580c" };
const t = (s: string) => s.replace(/_/g, " ");
const key = (a: string, b: string) => [a, b].sort().join("|");

/**
 * The job-level compatibility matrix: every pair of kinds of work, may they
 * share one possession. Each kind belongs to one department, so this is the
 * whole rule — click a cell to flip it. Every flip is logged as a decision
 * and retrains the pairwise model.
 */
export function WorkTypeMatrix({ readOnly = false }: { readOnly?: boolean }) {
  const [data, setData] = useState<Matrix | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const load = () => api.get<Matrix>("/api/v1/compatibility/work-types").then(setData);
  useEffect(() => {
    load();
  }, []);

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of data?.cells ?? []) m.set(key(c.type_a, c.type_b), c);
    return m;
  }, [data]);

  async function flip(a: string, b: string) {
    if (readOnly || !data) return;
    const cur = cellMap.get(key(a, b));
    const k = key(a, b);
    setBusy(k);
    try {
      await api.post("/api/v1/compatibility/work-types", { typeA: a, typeB: b, compatible: !(cur?.compatible ?? false), notes: cur?.notes ?? null });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!data) return null;
  const types = data.workTypes;
  const pm = data.pairModel;

  return (
    <div className="border border-ops-border">
      <div className="px-3 py-2 border-b border-ops-border flex items-start justify-between gap-4 flex-wrap">
        <p className="text-xs font-semibold text-ops-text">Work-type compatibility</p>
        <p className="text-[11px] text-right">
          <span className="text-ops-muted">Pairwise model: </span>
          {pm.active ? (
            <span className="text-emerald-400">active · {pm.rows} decisions{typeof pm.cv_auc === "number" ? ` · AUC ${pm.cv_auc.toFixed(2)}` : ""}</span>
          ) : (
            <span className="text-amber-400">inactive · {pm.rows} / 30 decisions</span>
          )}
        </p>
      </div>
      <div className="overflow-x-auto p-3">
        <table className="text-[10px] border-collapse">
          <thead>
            <tr>
              <th className="p-1" />
              {types.map((c) => (
                <th key={c.type} className="p-1 align-bottom">
                  <div className="h-28 flex items-end justify-center">
                    <span className="block whitespace-nowrap" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", color: DEPT_COLOR[c.department] }} title={c.department}>
                      {t(c.type)}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((r) => (
              <tr key={r.type}>
                <th className="p-1 text-right whitespace-nowrap font-medium" style={{ color: DEPT_COLOR[r.department] }} title={r.department}>
                  {t(r.type)}
                </th>
                {types.map((c) => {
                  const cell = cellMap.get(key(r.type, c.type));
                  const same = r.department === c.department;
                  const ok = same ? true : (cell?.compatible ?? false);
                  const k = key(r.type, c.type);
                  const edited = cell && cell.updated_by && cell.updated_by !== "seed";
                  return (
                    <td key={c.type} className="p-0.5">
                      <button
                        type="button"
                        disabled={readOnly || same || busy === k}
                        onClick={() => flip(r.type, c.type)}
                        onMouseEnter={() => setHover(cell ?? null)}
                        onMouseLeave={() => setHover(null)}
                        title={
                          same
                            ? `${r.department}: same department — jobs queue back to back`
                            : `${t(r.type)} + ${t(c.type)}: ${ok ? "may share" : "separate blocks"}${cell?.notes ? ` — ${cell.notes}` : ""}${edited ? ` (set by ${cell.updated_by})` : ""}`
                        }
                        className={`w-6 h-6 border ${same ? "bg-ops-inset border-ops-border cursor-default" : ok ? "bg-emerald-500/70 border-emerald-600" : "bg-red-500/60 border-red-600"} ${edited ? "ring-1 ring-ops-accent" : ""} ${busy === k ? "opacity-40" : ""} ${!readOnly && !same ? "hover:opacity-80" : ""}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-4 mt-2 text-[11px] text-ops-muted flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 inline-block bg-emerald-500/70 border border-emerald-600" /> may share a possession
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 inline-block bg-red-500/60 border border-red-600" /> separate blocks
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 inline-block bg-ops-inset border border-ops-border" /> same department (always)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 inline-block ring-1 ring-ops-accent" /> edited by a controller
          </span>
          {hover && (
            <span className="ml-auto text-ops-text">
              {t(hover.type_a)} + {t(hover.type_b)}: {hover.compatible ? "may share" : "separate"}
              {hover.notes ? ` — ${hover.notes}` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
