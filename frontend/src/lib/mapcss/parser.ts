// A small, honest subset of MapCSS (the OSM/JOSM styling language) — enough to
// style a rail network by tags: element-type selectors (`way`/`node`/`*`),
// bracket conditions (`[key]`, `[!key]`, `[key=value]`, `[key!=value]`), and a
// flat declaration block. No zoom-level ranges, child/descendant combinators,
// or `eval()` expressions — those are the parts of real MapCSS this app
// doesn't need. See mapcss/rail-style.mapcss for the actual stylesheet.

export type ConditionOp = "exists" | "not_exists" | "eq" | "neq";

export interface Condition {
  key: string;
  op: ConditionOp;
  value?: string;
}

export type ElementKind = "way" | "node" | "*";

export interface Selector {
  kind: ElementKind;
  conditions: Condition[];
}

export interface MapCssRule {
  selectors: Selector[];
  declarations: Record<string, string>;
  order: number; // source order, for cascade tie-breaking (last wins)
}

function parseConditions(raw: string): Condition[] {
  const conditions: Condition[] = [];
  const bracketRe = /\[([^\]]+)]/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(raw))) {
    const body = m[1].trim();
    if (body.startsWith("!")) {
      conditions.push({ key: body.slice(1).trim(), op: "not_exists" });
    } else if (body.includes("!=")) {
      const [key, value] = body.split("!=").map((s) => s.trim());
      conditions.push({ key, op: "neq", value: stripQuotes(value) });
    } else if (body.includes("=")) {
      const [key, value] = body.split("=").map((s) => s.trim());
      conditions.push({ key, op: "eq", value: stripQuotes(value) });
    } else {
      conditions.push({ key: body, op: "exists" });
    }
  }
  return conditions;
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseSelector(raw: string): Selector {
  const trimmed = raw.trim();
  const kindMatch = trimmed.match(/^(way|node|\*)/);
  const kind = (kindMatch ? kindMatch[1] : "*") as ElementKind;
  const rest = kindMatch ? trimmed.slice(kindMatch[0].length) : trimmed;
  return { kind, conditions: parseConditions(rest) };
}

function parseDeclarations(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stmt of raw.split(";")) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const prop = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[prop] = value;
  }
  return out;
}

export function parseMapCss(source: string): MapCssRule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: MapCssRule[] = [];
  const blockRe = /([^{}]+)\{([^{}]*)}/g;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = blockRe.exec(withoutComments))) {
    const selectorText = m[1].trim();
    if (!selectorText) continue;
    const declarations = parseDeclarations(m[2]);
    const selectors = selectorText.split(",").map(parseSelector);
    rules.push({ selectors, declarations, order: order++ });
  }
  return rules;
}
