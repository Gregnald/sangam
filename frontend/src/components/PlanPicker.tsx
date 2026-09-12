import { ALL_ZONES, type PeriodOption, type ZoneOption } from "../hooks/usePlanSelection";

export function PlanPicker({
  horizon,
  periods,
  period,
  onPeriodChange,
  zoneOptions,
  zone,
  onZoneChange,
  allowAllZones = true,
}: {
  horizon: "monthly" | "weekly";
  periods: PeriodOption[];
  period: string | null;
  onPeriodChange: (period: string | null) => void;
  zoneOptions: ZoneOption[];
  zone: string;
  onZoneChange: (zone: string) => void;
  allowAllZones?: boolean;
}) {
  const selectClass = "text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1";
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      <label className="flex items-center gap-2 text-ops-muted">
        {horizon === "monthly" ? "Month" : "Week"}
        <select value={period ?? ""} onChange={(e) => onPeriodChange(e.target.value || null)} className={selectClass}>
          {periods.map((p) => (
            <option key={p.period} value={p.period} title={p.period}>
              {p.label}
              {p.state === "current" ? " (current)" : p.state === "past" ? " (past)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-ops-muted">
        Zone
        <select value={zone} onChange={(e) => onZoneChange(e.target.value)} className={selectClass}>
          {allowAllZones && <option value={ALL_ZONES}>All zones (consolidated)</option>}
          {zoneOptions.map((z) => (
            <option key={z.zone || "—"} value={z.zone}>
              {z.zone || "—"}
              {z.hasPlan ? "" : " — no plan"}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
