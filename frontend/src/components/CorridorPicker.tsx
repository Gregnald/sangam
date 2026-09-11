import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import type { Corridor } from "../types/api";

export function CorridorPicker({ zone, value, onChange }: { zone: string | null; value: string | null; onChange: (id: string | null) => void }) {
  const [corridors, setCorridors] = useState<Corridor[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      api.get<Corridor[]>(`/api/v1/corridors${qs({ zone: zone ?? undefined, q: query.trim() || undefined })}`).then(setCorridors);
    }, 250);
    return () => clearTimeout(handle);
  }, [zone, query]);

  return (
    <div className="flex items-center gap-2">
      <input
        placeholder="Search corridor / station code…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1 w-56"
      />
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1 flex-1">
        <option value="">{query ? "Select a corridor…" : "Select a corridor (or type to search)…"}</option>
        {corridors.map((c) => (
          <option key={c.corridorId} value={c.corridorId}>
            {c.corridorId} — {c.stationACode}→{c.stationBCode} ({c.direction.toUpperCase()}, {c.trainCount} trains/day)
          </option>
        ))}
      </select>
    </div>
  );
}
