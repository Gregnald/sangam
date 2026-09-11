import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource } from "maplibre-gl";
import { parseMapCss } from "../lib/mapcss/parser";
import { applyMapCss } from "../lib/mapcss/compiler";
import railStyleSource from "../mapcss/rail-style.mapcss?raw";
import { api, qs } from "../lib/api";
import type { NetworkGeoJSON } from "../types/api";

const RULES = parseMapCss(railStyleSource);
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function NetworkMap({
  zone,
  selectedCorridor,
  onSelectCorridor,
  refreshKey,
  simulatedAt,
}: {
  zone: string | null;
  selectedCorridor: string | null;
  onSelectCorridor: (id: string, properties: Record<string, unknown>) => void;
  refreshKey?: number;
  simulatedAt?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [rawGeojson, setRawGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<NetworkGeoJSON>(`/api/v1/network/geojson${qs({ zone: zone ?? undefined, simulatedAt: simulatedAt ?? undefined })}`)
      .then((fc) => {
        if (!cancelled) {
          setRawGeojson(fc as unknown as GeoJSON.FeatureCollection);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [zone, refreshKey, simulatedAt]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0f1115" } }] },
      center: [78.9629, 22.5937],
      zoom: 4,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      try {
        map.addSource("rail", { type: "geojson", data: EMPTY_FC });

        map.addLayer({
          id: "rail-casing",
          type: "line",
          source: "rail",
          filter: ["all", ["==", ["get", "kind"], "way"], [">", ["get", "_style_casingWidth"], 0]],
          paint: {
            "line-color": ["get", "_style_casingColor"],
            "line-width": ["+", ["get", "_style_width"], ["*", ["get", "_style_casingWidth"], 2]],
            "line-opacity": ["get", "_style_opacity"],
          },
        });
        map.addLayer({
          id: "rail-line",
          type: "line",
          source: "rail",
          filter: ["==", ["get", "kind"], "way"],
          paint: {
            "line-color": ["get", "_style_color"],
            "line-width": ["get", "_style_width"],
            "line-opacity": ["get", "_style_opacity"],
          },
        });
        map.addLayer({
          id: "stations",
          type: "circle",
          source: "rail",
          filter: ["==", ["get", "kind"], "node"],
          paint: {
            "circle-radius": ["get", "_style_symbolSize"],
            "circle-color": ["get", "_style_fillColor"],
          },
          minzoom: 6,
        });

        map.on("click", "rail-line", (e) => {
          const f = e.features?.[0];
          if (f?.properties?.corridor_id) onSelectCorridor(f.properties.corridor_id, f.properties);
        });
        map.on("mousemove", "rail-line", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "rail-line", () => (map.getCanvas().style.cursor = ""));
      } catch (err) {
        console.error("[NetworkMap] failed to initialize map layers", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMapReady(true);
      }
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styled = useMemo(() => {
    if (!rawGeojson) return EMPTY_FC;
    const withSelection: GeoJSON.FeatureCollection = {
      ...rawGeojson,
      features: rawGeojson.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          selected: f.properties?.corridor_id && f.properties.corridor_id === selectedCorridor ? "yes" : undefined,
        },
      })),
    };
    return applyMapCss(withSelection, RULES);
  }, [rawGeojson, selectedCorridor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("rail") as GeoJSONSource | undefined)?.setData(styled as unknown as GeoJSON.FeatureCollection);
  }, [styled, mapReady]);

  // Fit to the loaded data's bounds only when a *new* dataset arrives (zone
  // change) — not on every selection click, which would otherwise re-fit on
  // each corridor click since `styled` also changes with `selectedCorridor`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !rawGeojson || rawGeojson.features.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    let has = false;
    for (const f of rawGeojson.features) {
      if (f.geometry.type === "LineString") {
        for (const c of f.geometry.coordinates) {
          bounds.extend(c as [number, number]);
          has = true;
        }
      } else if (f.geometry.type === "Point") {
        bounds.extend(f.geometry.coordinates as [number, number]);
        has = true;
      }
    }
    if (has) map.fitBounds(bounds, { padding: 30, maxZoom: 10, duration: 300 });
  }, [rawGeojson, mapReady]);

  return (
    <div className="relative w-full h-full bg-ops-bg">
      {/* MapLibre forces `position: relative` as an inline style on this
       * element, which would stomp a Tailwind `absolute inset-0` (inline
       * styles win over classes) and collapse it to zero height. */}
      <div ref={containerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 bg-ops-bg/80 flex items-center justify-center text-sm text-ops-muted z-10">
          Loading network…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 bg-ops-bg/90 flex items-center justify-center text-sm text-red-400 z-10 p-4 text-center">
          Could not reach the backend: {error}
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[11px] text-ops-muted bg-black/40 px-2 py-1 z-10">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#dc2626] inline-block" /> Blocked</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#d97706] inline-block" /> Train running</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-[#16a34a] inline-block" /> Clear</span>
      </div>
    </div>
  );
}
