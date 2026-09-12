import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface PairEvidence {
  deptA: string;
  deptB: string;
  seededCompatible: boolean;
  seededNotes: string | null;
  overridesYes: number;
  overridesNo: number;
  posteriorMean: number;
  learnedCompatible: boolean | null;
  inEffect: boolean;
}
interface Learned {
  minEvidence: number;
  flipThreshold: number;
  pairs: PairEvidence[];
}

/**
 * The default compatibility matrix is a prior; every per-window override the
 * controller records is an observation. This shows, per department pair,
 * what the evidence says and which default the planner is using right now.
 */
export function LearnedCompatibility({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<Learned | null>(null);
  useEffect(() => {
    api.get<Learned>("/api/v1/compatibility/learned").then(setData);
  }, [refreshKey]);
  if (!data) return null;
  const cross = data.pairs.filter((p) => p.deptA !== p.deptB);
  return (
    <div className="space-y-3">
    <div className="border border-ops-border">
      <div className="px-3 py-2 border-b border-ops-border">
        <p className="text-xs font-semibold text-ops-text">Department defaults — and what your per-block overrides have taught them</p>
        <p className="text-[11px] text-ops-muted mt-0.5">
          Department-level defaults, used only for a kind of work the matrix above doesn't know yet. They learn from your per-block overrides: after{" "}
          {data.minEvidence} overrides on a pair, a consistent pattern (≥ {Math.round(data.flipThreshold * 100)}%) replaces the seeded default.
        </p>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-ops-inset text-ops-muted uppercase text-[10px]">
          <tr>
            <th className="text-left p-2">Pair</th>
            <th className="text-left p-2">Seeded default</th>
            <th className="text-left p-2">Your overrides</th>
            <th className="text-left p-2">P(may share)</th>
            <th className="text-left p-2">Learned</th>
            <th className="text-left p-2">In effect</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ops-border">
          {cross.map((p) => (
            <tr key={`${p.deptA}-${p.deptB}`}>
              <td className="p-2 text-ops-text font-semibold">
                {p.deptA} + {p.deptB}
              </td>
              <td className={`p-2 ${p.seededCompatible ? "text-emerald-400" : "text-red-400"}`} title={p.seededNotes ?? undefined}>
                {p.seededCompatible ? "may share" : "separate blocks"}
              </td>
              <td className="p-2 text-ops-muted mono">
                {p.overridesYes} yes · {p.overridesNo} no
              </td>
              <td className="p-2 text-ops-text mono">{p.posteriorMean.toFixed(2)}</td>
              <td className="p-2 text-ops-muted">
                {p.learnedCompatible === null
                  ? `not yet (${Math.max(0, data.minEvidence - p.overridesYes - p.overridesNo)} more overrides needed)`
                  : p.learnedCompatible
                    ? "may share"
                    : "separate blocks"}
              </td>
              <td className={`p-2 font-semibold ${p.inEffect ? "text-emerald-400" : "text-red-400"}`}>
                {p.inEffect ? "MAY SHARE" : "SEPARATE"}
                {p.learnedCompatible !== null && p.learnedCompatible !== p.seededCompatible && <span className="ml-1 text-[10px] text-ops-accent">(learned)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    </div>
  );
}
