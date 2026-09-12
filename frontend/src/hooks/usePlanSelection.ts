import { useEffect, useMemo, useRef, useState } from "react";
import { periodLabelText, planTimeState } from "../lib/dates";
import type { BlockPlan, ZoneSummary } from "../types/api";

export const ALL_ZONES = "__all__";

export interface PeriodOption {
  period: string;
  horizonStart: string;
  horizonEnd: string;
  state: "past" | "current" | "upcoming";
  label: string;
}

export interface ZoneOption {
  zone: string;
  hasPlan: boolean;
}

/**
 * Period (month / week) → zone selection over a list of plans. Periods come
 * from the plans themselves (a month with no plan isn't selectable); zones
 * come from the store so a zone without a plan is still offered, flagged.
 * Defaults to the period covering today (else the latest) and to all zones;
 * a selection survives refetches and only resets when its period vanishes.
 */
export function usePlanSelection(horizon: "monthly" | "weekly", plans: BlockPlan[], zones: ZoneSummary[], defaultZone?: string | null) {
  const [period, setPeriod] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  const periods = useMemo<PeriodOption[]>(() => {
    const byPeriod = new Map<string, BlockPlan>();
    for (const p of plans) {
      const cur = byPeriod.get(p.periodLabel);
      if (!cur || p.horizonStart < cur.horizonStart) byPeriod.set(p.periodLabel, p);
    }
    return [...byPeriod.values()]
      .sort((a, b) => b.horizonStart.localeCompare(a.horizonStart))
      .map((p) => ({
        period: p.periodLabel,
        horizonStart: p.horizonStart,
        horizonEnd: p.horizonEnd,
        state: planTimeState(p.horizonStart, p.horizonEnd),
        // A weekly plan derived from a month can be clipped (e.g. 1–4 Oct);
        // the option still names the whole ISO week so it reads naturally.
        label: periodLabelText(horizon, p.periodLabel, horizon === "weekly" ? null : p.horizonStart, horizon === "weekly" ? null : p.horizonEnd),
      }));
  }, [plans, horizon]);

  useEffect(() => {
    if (period && periods.some((p) => p.period === period)) return;
    const current = periods.find((p) => p.state === "current");
    setPeriod(current?.period ?? periods[0]?.period ?? null);
  }, [periods, period]);

  const periodPlans = useMemo(() => plans.filter((p) => p.periodLabel === period), [plans, period]);

  const zoneOptions = useMemo<ZoneOption[]>(() => {
    const withPlan = new Set(periodPlans.map((p) => p.zone ?? ""));
    const known = zones.map((z) => z.zone ?? "");
    for (const z of withPlan) if (!known.includes(z)) known.push(z);
    return known.sort().map((z) => ({ zone: z, hasPlan: withPlan.has(z) }));
  }, [zones, periodPlans]);

  // Default to one zone — the caller's preferred zone if it has a plan for
  // this period, else the first zone that does — so the view opens on a
  // single card rather than every zone's. "All zones" is a deliberate pick.
  // Until the user picks a zone themselves, keep auto-choosing: plans load
  // after zones do, so the first pass may see no plan anywhere yet.
  const userPicked = useRef(false);
  useEffect(() => {
    if (userPicked.current) return;
    const withPlan = zoneOptions.filter((z) => z.hasPlan);
    if (withPlan.length === 0) return;
    if (zone !== null && zone !== ALL_ZONES && withPlan.some((z) => z.zone === zone)) return;
    const preferred = defaultZone ? withPlan.find((z) => z.zone === defaultZone) : undefined;
    setZone((preferred ?? withPlan[0]).zone);
  }, [zone, zoneOptions, defaultZone]);

  const pickZone = (z: string) => {
    userPicked.current = true;
    setZone(z);
  };

  const selectedPlans = useMemo(
    () => periodPlans.filter((p) => zone === ALL_ZONES || (p.zone ?? "") === zone).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
    [periodPlans, zone],
  );

  const byZone = useMemo(() => {
    const m = new Map<string, BlockPlan[]>();
    for (const p of selectedPlans) {
      const key = p.zone ?? "";
      const list = m.get(key);
      if (list) list.push(p);
      else m.set(key, [p]);
    }
    return new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }, [selectedPlans]);

  const periodOption = periods.find((p) => p.period === period) ?? null;

  return { periods, period, setPeriod, periodOption, zone: zone ?? "", setZone: pickZone, zoneOptions, selectedPlans, byZone };
}
