import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MC_COLORS } from "../src/core/mcFormat";
import { REWARD_TYPES, TASK_TYPES } from "../src/core/registry";
import { initialSteps } from "../src/ui/LoadingOverlay";
import { tr } from "../src/locales/tr";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "locales" ? [] : sources(p);
    return /\.tsx?$/.test(f) ? [readFileSync(p, "utf8")] : [];
  });
}

/** Every English UI string: t("…") literals, undo labels and the labels data tables hold. */
function uiStrings(): Set<string> {
  const keys = new Set<string>();
  for (const s of sources("src")) {
    for (const m of s.matchAll(/[^\w.]t\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`) as string);
    for (const m of s.matchAll(/(?:edit|commit)\(\s*"([^"]+)"/g)) keys.add(m[1]!);
    for (const m of s.matchAll(/"((?:add|delete) (?:task|reward))"/g)) keys.add(m[1]!);
    // flag tables: ["key", "Label"(, "Hint")]
    for (const m of s.matchAll(/\["[a-z_]+", "([A-Z][^"]+)"(?:, "([^"]+)")?\]/g)) {
      keys.add(m[1]!);
      if (m[2]) keys.add(m[2]);
    }
  }
  for (const field of ["title", "subtitle", "description"]) keys.add(`change ${field}`);
  for (const spec of [...TASK_TYPES, ...REWARD_TYPES]) {
    keys.add(spec.label);
    for (const f of spec.fields) keys.add(f.label);
  }
  for (const c of MC_COLORS) keys.add(c.name);
  for (const s of initialSteps(true)) keys.add(s.label);
  return keys;
}

describe("Turkish translation", () => {
  it("covers every UI string", () => {
    const missing = [...uiStrings()].filter((k) => !(k in tr));
    if (missing.length) console.log(JSON.stringify(missing, null, 1));
    expect(missing).toEqual([]);
  });

  it("keeps the same {placeholders}", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const wrong = Object.entries(tr).filter(([en, t]) => names(en).join() !== names(t).join());
    expect(wrong).toEqual([]);
  });
});
