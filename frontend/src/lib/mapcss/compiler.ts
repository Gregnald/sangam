// Evaluates parsed MapCSS rules against GeoJSON feature properties and bakes
// the resolved style onto each feature. MapLibre GL then just reads the baked
// `_style_*` properties via simple `["get", ...]` paint expressions — this is
// what lets *MapCSS* be the actual styling authority while MapLibre stays the
// battle-tested renderer underneath it (see NetworkMap.tsx).

import type { Condition, MapCssRule, Selector } from "./parser";

export interface ResolvedStyle {
  color: string;
  width: number;
  opacity: number;
  dashes: number[] | null;
  casingColor: string | null;
  casingWidth: number;
  symbolShape: "circle" | "square" | null;
  symbolSize: number;
  fillColor: string;
  textField: string | null;
  textColor: string;
  fontSize: number;
  zIndex: number;
}

const DEFAULT_STYLE: ResolvedStyle = {
  color: "#94a3b8",
  width: 2,
  opacity: 1,
  dashes: null,
  casingColor: null,
  casingWidth: 0,
  symbolShape: null,
  symbolSize: 4,
  fillColor: "#1e293b",
  textField: null,
  textColor: "#1e293b",
  fontSize: 11,
  zIndex: 0,
};

type FeatureLike = { properties: Record<string, unknown> | null; geometry?: { type: string } };

function matchesCondition(props: Record<string, unknown>, cond: Condition): boolean {
  const has = Object.prototype.hasOwnProperty.call(props, cond.key) && props[cond.key] !== null && props[cond.key] !== undefined;
  switch (cond.op) {
    case "exists":
      return has;
    case "not_exists":
      return !has;
    case "eq":
      return has && String(props[cond.key]) === cond.value;
    case "neq":
      return !has || String(props[cond.key]) !== cond.value;
    default:
      return false;
  }
}

function selectorKindMatches(selector: Selector, feature: FeatureLike): boolean {
  if (selector.kind === "*") return true;
  const kind = (feature.properties?.kind as string) ?? (feature.geometry?.type === "Point" ? "node" : "way");
  return kind === selector.kind;
}

function matchesSelector(selector: Selector, feature: FeatureLike): boolean {
  if (!selectorKindMatches(selector, feature)) return false;
  const props = feature.properties ?? {};
  return selector.conditions.every((c) => matchesCondition(props, c));
}

function ruleMatches(rule: MapCssRule, feature: FeatureLike): boolean {
  return rule.selectors.some((s) => matchesSelector(s, feature));
}

function applyDeclarations(style: ResolvedStyle, declarations: Record<string, string>): ResolvedStyle {
  const next = { ...style };
  for (const [prop, rawValue] of Object.entries(declarations)) {
    const value = rawValue.trim();
    switch (prop) {
      case "color":
        next.color = value;
        break;
      case "width":
        next.width = parseFloat(value);
        break;
      case "opacity":
        next.opacity = parseFloat(value);
        break;
      case "dashes":
        next.dashes = value.split(",").map((v) => parseFloat(v.trim()));
        break;
      case "casing-color":
        next.casingColor = value;
        break;
      case "casing-width":
        next.casingWidth = parseFloat(value);
        break;
      case "symbol-shape":
        next.symbolShape = value as "circle" | "square";
        break;
      case "symbol-size":
        next.symbolSize = parseFloat(value);
        break;
      case "fill-color":
        next.fillColor = value;
        break;
      case "text":
        next.textField = value;
        break;
      case "text-color":
        next.textColor = value;
        break;
      case "font-size":
        next.fontSize = parseFloat(value);
        break;
      case "z-index":
        next.zIndex = parseFloat(value);
        break;
      default:
        break;
    }
  }
  return next;
}

export function computeStyle(feature: FeatureLike, rules: MapCssRule[]): ResolvedStyle {
  let style = { ...DEFAULT_STYLE };
  for (const rule of rules) {
    if (ruleMatches(rule, feature)) {
      style = applyDeclarations(style, rule.declarations);
    }
  }
  return style;
}

export interface StyledFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
}

/** Bakes `_style_*` properties onto every feature and sorts by z-index
 * ascending so later (higher-priority) features paint on top within a layer. */
export function applyMapCss(fc: GeoJSON.FeatureCollection, rules: MapCssRule[]): StyledFeatureCollection {
  const styled = fc.features.map((f) => {
    const style = computeStyle(f as FeatureLike, rules);
    const props = f.properties ?? {};
    const label = style.textField ? String(props[style.textField] ?? "") : "";
    return {
      ...f,
      properties: {
        ...props,
        _style_color: style.color,
        _style_width: style.width,
        _style_opacity: style.opacity,
        _style_dashes: style.dashes ? style.dashes.join(",") : "",
        _style_casingColor: style.casingColor ?? style.color,
        _style_casingWidth: style.casingWidth,
        _style_symbolShape: style.symbolShape ?? "",
        _style_symbolSize: style.symbolSize,
        _style_fillColor: style.fillColor,
        _style_label: label,
        _style_textColor: style.textColor,
        _style_fontSize: style.fontSize,
        _style_zIndex: style.zIndex,
      },
    } as GeoJSON.Feature;
  });

  styled.sort((a, b) => (a.properties?._style_zIndex ?? 0) - (b.properties?._style_zIndex ?? 0));
  return { type: "FeatureCollection", features: styled };
}
