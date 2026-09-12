import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { useAppStore } from "../store/appStore";
import type { Corridor } from "../types/api";

/**
 * Zone first, then corridor. A corridor id alone (COR-XXX-YYY) is not
 * something anyone can pick out of ~17,000; narrowing to a railway zone
 * first turns the list into a few hundred, and the search box does the rest.
 *
 * `zone` is the initial zone. With `lockZone` the zone can't be changed —
 * used where the context already fixes it (a plan is solved for one zone).
 *
 * `blockCounts` (corridor id → number of blocks) appends "[N blocks]" to a
 * corridor's option, tints it and lists it first, so a plan's corridors with
 * work on them stand out from the hundreds with none. A native <option> can
 * only be coloured as a whole, so the tint covers the line, not just the
 * bracket.
 */
export function CorridorPicker({
  zone,
  value,
  onChange,
  lockZone = false,
  onZoneChange,
  blockCounts,
  className = "",
}: {
  zone: string | null;
  value: string | null;
  onChange: (id: string | null) => void;
  lockZone?: boolean;
  onZoneChange?: (zone: string | null) => void;
  blockCounts?: Record<string, number>;
  className?: string;
}) {
  const zones = useAppStore((s) => s.zones);
  const fetchZones = useAppStore((s) => s.fetchZones);
  const [zoneState, setZoneState] = useState<string | null>(zone);
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (zones.length === 0) fetchZones();
  }, [zones.length, fetchZones]);

  // Follow the prop when the parent changes context (e.g. a different plan).
  useEffect(() => {
    setZoneState(zone);
  }, [zone]);

  useEffect(() => {
    if (!zoneState) {
      setCorridors([]);
      return;
    }
    const handle = setTimeout(() => {
      api.get<Corridor[]>(`/api/v1/corridors${qs({ zone: zoneState, q: query.trim() || undefined })}`).then(setCorridors);
    }, 250);
    return () => clearTimeout(handle);
  }, [zoneState, query]);

  function pickZone(z: string | null) {
    setZoneState(z);
    setQuery("");
    onChange(null);
    onZoneChange?.(z);
  }

  // Corridors that have blocks first (busiest-with-blocks first, then the
  // traffic order the API already returns), so they aren't buried under the
  // hundreds without any.
  const listed = blockCounts
    ? [...corridors].sort((a, b) => Number((blockCounts[b.corridorId] ?? 0) > 0) - Number((blockCounts[a.corridorId] ?? 0) > 0))
    : corridors;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <select
        value={zoneState ?? ""}
        onChange={(e) => pickZone(e.target.value || null)}
        disabled={lockZone}
        title={lockZone ? "Zone is fixed by the plan being viewed" : "Railway zone"}
        className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1 disabled:opacity-70"
      >
        <option value="">Zone…</option>
        {zones.map((z) => (
          <option key={z.zone ?? "none"} value={z.zone ?? ""}>
            {z.zone} ({z.corridors} corridors)
          </option>
        ))}
      </select>
      <input
        placeholder={zoneState ? "Search corridor / station code…" : "Pick a zone first"}
        value={query}
        disabled={!zoneState}
        onChange={(e) => setQuery(e.target.value)}
        className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1 w-52 disabled:opacity-60"
      />
      <select
        value={value ?? ""}
        disabled={!zoneState}
        onChange={(e) => onChange(e.target.value || null)}
        className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1 flex-1 min-w-64 disabled:opacity-60"
      >
        <option value="">{!zoneState ? "Pick a zone first…" : query ? "Select a corridor…" : "Select a corridor (or type to search)…"}</option>
        {listed.map((c) => {
          const blocks = blockCounts?.[c.corridorId] ?? 0;
          return (
            <option key={c.corridorId} value={c.corridorId} className={blocks > 0 ? "text-ops-accent font-semibold" : undefined}>
              {c.corridorId} — {c.stationACode}→{c.stationBCode} ({c.direction.toUpperCase()}, {c.trainCount} trains/day)
              {blocks > 0 && ` [${blocks} ${blocks === 1 ? "block" : "blocks"}]`}
            </option>
          );
        })}
      </select>
    </div>
  );
}
