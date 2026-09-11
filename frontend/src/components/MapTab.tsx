import { useState } from "react";
import { NetworkMap } from "./NetworkMap";
import { CorridorSchedulePanel } from "./CorridorSchedulePanel";
import { useAppStore } from "../store/appStore";

export function MapTab() {
  const { zones, selectedZone, setSelectedZone, mapRefreshKey } = useAppStore();
  const [selectedCorridor, setSelectedCorridor] = useState<string | null>(null);
  const [corridorInfo, setCorridorInfo] = useState<Record<string, unknown> | null>(null);
  const [simulatedAt, setSimulatedAt] = useState<string>("");

  return (
    <div className="h-full flex flex-col gap-3 lg:flex-row">
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={selectedZone ?? ""} onChange={(e) => setSelectedZone(e.target.value || null)} className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1">
            <option value="">All zones (whole India)</option>
            {zones.map((z) => (
              <option key={z.zone ?? "none"} value={z.zone ?? ""}>
                {z.zone} ({z.pendingRequests} pending, {z.corridors} corridors)
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[11px] text-ops-muted">
            Simulate date/time:
            <input
              type="datetime-local"
              value={simulatedAt}
              onChange={(e) => setSimulatedAt(e.target.value)}
              className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1"
            />
          </label>
          {simulatedAt && (
            <button onClick={() => setSimulatedAt("")} className="text-[11px] text-ops-accent underline">
              Reset to now
            </button>
          )}
        </div>
        <div className="flex-1 border border-ops-border min-h-[420px]">
          <NetworkMap
            zone={selectedZone}
            selectedCorridor={selectedCorridor}
            refreshKey={mapRefreshKey}
            simulatedAt={simulatedAt ? new Date(simulatedAt).toISOString() : null}
            onSelectCorridor={(id, props) => {
              setSelectedCorridor(id);
              setCorridorInfo(props);
            }}
          />
        </div>
      </div>
      {selectedCorridor && (
        <div className="w-full lg:w-96 shrink-0">
          <CorridorSchedulePanel
            corridorId={selectedCorridor}
            corridorInfo={corridorInfo}
            initialAnchor={simulatedAt ? new Date(simulatedAt).toISOString() : null}
            onClose={() => setSelectedCorridor(null)}
            onSwitchCorridor={(id) => {
              setSelectedCorridor(id);
              setCorridorInfo((prev) => {
                if (!prev) return prev;
                const a = String(prev.station_a_code ?? "");
                const b = String(prev.station_b_code ?? "");
                const newDirection = prev.direction === "up" ? "down" : "up";
                return {
                  ...prev,
                  corridor_id: id,
                  station_a_code: b,
                  station_b_code: a,
                  direction: newDirection,
                  direction_label: `${b} → ${a} (${newDirection.toUpperCase()})`,
                  opposite_corridor_id: prev.corridor_id,
                };
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
