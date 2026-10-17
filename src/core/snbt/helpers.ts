import type { NumberType, SnbtCompound, SnbtList, SnbtValue } from "./types";

// Typed accessors for compounds. Setters keep the existing numeric type of a key
// and insert new keys in alphabetical order when the compound is already sorted,
// which is how FTB Quests writes its files.

export function getString(c: SnbtCompound, key: string): string | undefined {
  const v = c.entries.get(key);
  return v?.kind === "string" ? v.value : undefined;
}

export function getNumber(c: SnbtCompound, key: string): number | undefined {
  const v = c.entries.get(key);
  return v?.kind === "number" ? v.value : undefined;
}

export function getBool(c: SnbtCompound, key: string): boolean | undefined {
  const v = c.entries.get(key);
  if (v?.kind === "bool") return v.value;
  if (v?.kind === "number" && v.type === "byte") return v.value !== 0;
  return undefined;
}

export function getList(c: SnbtCompound, key: string): SnbtList | undefined {
  const v = c.entries.get(key);
  return v?.kind === "list" ? v : undefined;
}

export function getCompound(c: SnbtCompound, key: string): SnbtCompound | undefined {
  const v = c.entries.get(key);
  return v?.kind === "compound" ? v : undefined;
}

/** Compounds contained in a list, skipping anything else. */
export function compounds(list: SnbtList | undefined): SnbtCompound[] {
  return (list?.items ?? []).filter((v): v is SnbtCompound => v.kind === "compound");
}

export function strings(list: SnbtValue | undefined): string[] {
  if (list?.kind === "string") return [list.value];
  if (list?.kind !== "list") return [];
  return list.items.flatMap((v) => (v.kind === "string" ? [v.value] : []));
}

function isSorted(keys: string[]): boolean {
  for (let i = 1; i < keys.length; i++) if (keys[i - 1]! > keys[i]!) return false;
  return true;
}

export function setEntry(c: SnbtCompound, key: string, value: SnbtValue): void {
  if (c.entries.has(key)) {
    c.entries.set(key, value);
    return;
  }
  const keys = [...c.entries.keys()];
  if (keys.length === 0 || !isSorted(keys) || key > keys[keys.length - 1]!) {
    c.entries.set(key, value);
    return;
  }
  const rebuilt = new Map<string, SnbtValue>();
  let inserted = false;
  for (const [k, v] of c.entries) {
    if (!inserted && key < k) {
      rebuilt.set(key, value);
      inserted = true;
    }
    rebuilt.set(k, v);
  }
  c.entries = rebuilt;
}

export function deleteEntry(c: SnbtCompound, key: string): void {
  c.entries.delete(key);
}

export function setString(c: SnbtCompound, key: string, value: string): void {
  const existing = c.entries.get(key);
  if (existing?.kind === "string") existing.value = value;
  else setEntry(c, key, { kind: "string", value });
}

export function setNumber(c: SnbtCompound, key: string, value: number, defaultType: NumberType): void {
  const existing = c.entries.get(key);
  if (existing?.kind === "number") existing.value = existing.type === "double" || existing.type === "float" ? value : Math.trunc(value);
  else setEntry(c, key, { kind: "number", type: defaultType, value });
}

/**
 * Exact value of a long, read from the original text when available.
 * FTB stores 64-bit ids (e.g. `table_id`) that do not fit in a JS number.
 */
export function getLong(c: SnbtCompound, key: string): bigint | undefined {
  const v = c.entries.get(key);
  if (v?.kind !== "number") return undefined;
  if (v.raw !== undefined && Number(v.raw.replace(/[bslfd]$/i, "")) === v.value) {
    return BigInt(v.raw.replace(/[bslfd]$/i, "").replace(/^\+/, ""));
  }
  return BigInt(Math.trunc(v.value));
}

export function setLong(c: SnbtCompound, key: string, value: bigint): void {
  setEntry(c, key, { kind: "number", type: "long", value: Number(value), raw: `${value}L` });
}

export function setBool(c: SnbtCompound, key: string, value: boolean): void {
  const existing = c.entries.get(key);
  if (existing?.kind === "number" && existing.type === "byte") existing.value = value ? 1 : 0;
  else setEntry(c, key, { kind: "bool", value });
}

/** Boolean that defaults to false: FTB only writes it when true, so false removes the key. */
export function setFlag(c: SnbtCompound, key: string, value: boolean): void {
  if (value) setBool(c, key, true);
  else c.entries.delete(key);
}

/** Sets a string list; removes the key entirely when `values` is empty and `keepEmpty` is false. */
export function setStrings(c: SnbtCompound, key: string, values: string[], opts: { inline?: boolean; keepEmpty?: boolean } = {}): void {
  if (values.length === 0 && !opts.keepEmpty) {
    c.entries.delete(key);
    return;
  }
  const existing = c.entries.get(key);
  const inline = existing?.kind === "list" ? existing.inline : opts.inline;
  setEntry(c, key, { kind: "list", inline, items: values.map((value) => ({ kind: "string", value })) });
}

export function cloneValue<T extends SnbtValue>(v: T): T {
  switch (v.kind) {
    case "compound":
      return { ...v, entries: new Map([...v.entries].map(([k, x]) => [k, cloneValue(x)])) };
    case "list":
      return { ...v, items: v.items.map(cloneValue) };
    case "array":
      return { ...v, items: v.items.map((x) => ({ ...x })) };
    default:
      return { ...v };
  }
}
