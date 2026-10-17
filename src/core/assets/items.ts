import type { AssetIndex } from "./assetIndex";

// Turns an item id into something drawable, following Minecraft's model rules:
// item model -> parent chain -> textures. Handheld/generated items are flat layers,
// block items become an isometric cube, plants (cross models) are flat.

export interface Texture {
  png: Uint8Array;
  /** Multiply color for textures that Minecraft tints at runtime (grass, leaves…). */
  tint?: string;
}

export interface TranslationSource {
  text: string;
  /** Instance-relative lang file when it can be edited (KubeJS assets), e.g. `kubejs/assets/modpack/lang/en_us.json`. */
  instancePath?: string;
}

export type FaceName = "up" | "down" | "north" | "south" | "west" | "east";
type Vec3 = [number, number, number];

export interface ModelFace {
  texture: Texture;
  /** u1, v1, u2, v2 in 0..16 */
  uv: [number, number, number, number];
  rotation: number;
}

export interface ModelElement {
  from: Vec3;
  to: Vec3;
  rotation?: { origin: Vec3; axis: "x" | "y" | "z"; angle: number };
  faces: Partial<Record<FaceName, ModelFace>>;
}

export type ItemIcon =
  | { kind: "flat"; layers: Texture[] }
  | { kind: "cube"; top: Texture; left: Texture; right: Texture }
  /** A model built from elements (Blockbench-style), drawn with its GUI rotation. */
  | { kind: "model"; elements: ModelElement[]; rotation: Vec3 };

interface RawElement {
  from?: Vec3;
  to?: Vec3;
  rotation?: { origin?: Vec3; axis?: string; angle?: number };
  faces?: Partial<Record<FaceName, { texture?: string; uv?: number[]; rotation?: number }>>;
}

interface Model {
  parent?: string;
  textures?: Record<string, string>;
  elements?: RawElement[];
  loader?: string;
  display?: { gui?: { rotation?: Vec3 } };
}

interface ResolvedModel {
  chain: string[];
  textures: Record<string, string>;
  /** From the nearest model in the chain that has them. */
  elements?: RawElement[];
  guiRotation?: Vec3;
  /** Geometry comes from mod code (custom loader); its textures alone do not make an icon. */
  loader: boolean;
}

/** Minecraft's default UVs, derived from the element's position. */
function defaultUv(face: FaceName, from: Vec3, to: Vec3): [number, number, number, number] {
  const [fx, fy, fz] = from;
  const [tx, ty, tz] = to;
  switch (face) {
    case "up":
    case "down":
      return [fx, fz, tx, tz];
    case "north":
      return [16 - tx, 16 - ty, 16 - fx, 16 - fy];
    case "south":
      return [fx, 16 - ty, tx, 16 - fy];
    case "west":
      return [fz, 16 - ty, tz, 16 - fy];
    case "east":
      return [16 - tz, 16 - ty, 16 - fz, 16 - fy];
  }
}

const MAX_ELEMENTS = 300;

const FLAT_PARENTS = new Set(["minecraft:item/generated", "minecraft:builtin/generated", "minecraft:item/handheld"]);
const CROSS_PARENTS = new Set(["minecraft:block/cross", "minecraft:block/tinted_cross"]);
const FOLIAGE = /(grass_block_top|grass_block_side_overlay|\/grass$|\/tall_grass|\/fern$|large_fern|leaves|\/vine$|lily_pad|sugar_cane)/;
const FOLIAGE_COLOR = "#79c05a";

/** `log` -> `minecraft:log`; `#var` is kept. */
function qualify(ref: string): string {
  if (ref.startsWith("#") || ref.includes(":")) return ref;
  return `minecraft:${ref}`;
}

/** Strings anywhere in a JSON value that look like texture references (`ns:block/x`, `item/y`). */
function scanStrings(json: unknown, out: string[] = []): string[] {
  if (typeof json === "string") {
    if (/^([a-z0-9_.-]+:)?(block|item|blocks|items)\/[a-z0-9_./-]+$/.test(json)) out.push(json);
  } else if (Array.isArray(json)) json.forEach((v) => scanStrings(v, out));
  else if (json && typeof json === "object") Object.values(json).forEach((v) => scanStrings(v, out));
  return out;
}

/** Readable fallback name from an id: `ars_nouveau:glyph_leap` -> "Glyph Leap". */
export function prettifyId(itemId: string): string {
  return (split(itemId)[1].split("/").pop() ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function split(id: string): [string, string] {
  const i = id.indexOf(":");
  return i < 0 ? ["minecraft", id] : [id.slice(0, i), id.slice(i + 1)];
}

export class ItemAssets {
  private icons = new Map<string, Promise<ItemIcon | null>>();
  private langs = new Map<string, Promise<Record<string, string> | null>>();

  constructor(
    readonly index: AssetIndex,
    readonly locale = "en_us",
  ) {}

  /** Display name from the mod's lang file, e.g. `minecraft:oak_log` -> "Oak Log". */
  async name(itemId: string): Promise<string | null> {
    const [ns, path] = split(itemId);
    const key = path.replace(/\//g, ".");
    for (const locale of new Set([this.locale, "en_us"])) {
      const lang = await this.lang(ns, locale);
      const found = lang?.[`item.${ns}.${key}`] ?? lang?.[`block.${ns}.${key}`];
      // Some mods fill names at runtime ("%s%sIron Chest"); drop the placeholders.
      if (found) return found.replace(/%(\d+\$)?s/g, "").replace(/\s{2,}/g, " ").trim() || found;
    }
    return null;
  }

  /**
   * Looks up `keys` in every `lang/<locale>.json` (falling back to en_us), for texts written as
   * `{translation.key}`. Only the requested keys are kept, so big packs do not fill memory.
   */
  async translations(keys: Iterable<string>, onProgress?: (done: number, total: number) => void): Promise<Map<string, TranslationSource>> {
    const wanted = new Set(keys);
    const found = new Map<string, TranslationSource>();
    if (wanted.size === 0) return found;
    const locales = [...new Set(["en_us", this.locale])]; // later locale wins
    const files = locales.flatMap((l) => this.index.paths((p) => p.endsWith(`/lang/${l}.json`)));
    // Read in parallel, keep only wanted keys per file, then apply in file order (later wins).
    const perFile: [string, string][][] = new Array(files.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        // Not index.json(): that would cache hundreds of whole lang files.
        const bytes = await this.index.bytes(files[i]!);
        try {
          const lang: Record<string, unknown> = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : {};
          perFile[i] = Object.entries(lang).filter((e): e is [string, string] => wanted.has(e[0]) && typeof e[1] === "string");
        } catch {
          perFile[i] = []; // malformed lang file
        }
        onProgress?.(++done, files.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    files.forEach((file, i) => {
      const instancePath = this.index.instancePath(file);
      for (const [k, v] of perFile[i] ?? []) found.set(k, { text: v, instancePath });
    });
    return found;
  }

  private itemList?: Promise<{ id: string; name: string }[]>;

  /** Every item that has an item model in the pack, with its display name (cached). */
  allItems(): Promise<{ id: string; name: string }[]> {
    this.itemList ??= (async () => {
      const MODEL = /^assets\/([^/]+)\/models\/item\/(.+)\.json$/;
      const ids = this.index.paths((p) => MODEL.test(p)).map((p) => {
        const m = MODEL.exec(p)!;
        return `${m[1]}:${m[2]}`;
      });
      const out: { id: string; name: string }[] = [];
      for (const id of ids) out.push({ id, name: (await this.name(id)) ?? prettifyId(id) });
      return out.sort((a, b) => a.name.localeCompare(b.name));
    })();
    return this.itemList;
  }

  /**
   * Raw PNG of a texture reference as FTB writes them for images:
   * `ns:textures/path/x.png` or `ns:path/x` (both mean assets/ns/textures/path/x.png).
   */
  async textureBytes(ref: string): Promise<Uint8Array | null> {
    const [ns, path] = split(qualify(ref.replace(/^texture:/, "")));
    return this.index.bytes(`assets/${ns}/textures/${path.replace(/^textures\//, "").replace(/\.png$/, "")}.png`);
  }

  icon(itemId: string): Promise<ItemIcon | null> {
    let cached = this.icons.get(itemId);
    if (!cached) {
      cached = this.resolveIcon(itemId).catch(() => null);
      this.icons.set(itemId, cached);
    }
    return cached;
  }

  private lang(ns: string, locale: string) {
    const key = `${ns}/${locale}`;
    let cached = this.langs.get(key);
    if (!cached) {
      cached = this.index.json<Record<string, string>>(`assets/${ns}/lang/${locale}.json`);
      this.langs.set(key, cached);
    }
    return cached;
  }

  private async resolveIcon(itemId: string): Promise<ItemIcon | null> {
    // FTB custom icons: "ns:textures/item/x.png" or "ns:item/x".
    if (itemId.startsWith("texture:")) {
      const [ns, path] = split(itemId.slice("texture:".length));
      const t = await this.texture(`${ns}:${path.replace(/^textures\//, "").replace(/\.png$/, "")}`);
      return t ? { kind: "flat", layers: [t] } : null;
    }
    const [ns, path] = split(itemId);
    const model = await this.resolveModel(`${ns}:item/${path}`);
    const fromItem = model && (await this.fromModel(model));
    if (fromItem) return fromItem;

    // Entity-rendered items (GeckoLib, chests…) or missing item models: use the block's model.
    const blockModel = await this.blockstateModel(ns, path);
    const resolved = blockModel ? await this.resolveModel(blockModel) : null;
    const fromBlock = resolved && (await this.fromModel(resolved, true));
    if (fromBlock) return fromBlock;

    // Custom model loaders keep textures in their own fields: take an existing texture they mention.
    // With code-built geometry only one named like the item is trusted (others are UV atlases).
    const codeBuilt = !!(model?.loader || resolved?.loader);
    const words = path.split(/[/_]/).filter((w) => w.length > 2);
    for (const file of [...(model?.chain ?? []), ...(resolved?.chain ?? [])]) {
      const [mns, mpath] = split(file);
      for (const ref of scanStrings(await this.index.json(`assets/${mns}/models/${mpath}.json`))) {
        if (codeBuilt && !words.some((w) => (ref.split("/").pop() ?? "").includes(w))) continue;
        const t = await this.texture(ref);
        if (t) return { kind: "flat", layers: [t] };
      }
    }
    if (codeBuilt) return null;

    // Last resort: guess from texture names.
    for (const [dir, kind] of [
      ["item", "flat"],
      ["items", "flat"],
      ["block", "cube"],
      ["blocks", "cube"],
    ] as const) {
      const t = await this.texture(`${ns}:${dir}/${path}`);
      if (t) return kind === "flat" ? { kind, layers: [t] } : { kind, top: t, left: t, right: t };
    }
    return null;
  }

  private async fromModel(model: ResolvedModel, forceBlock = false): Promise<ItemIcon | null> {
    const tex = (key: string) => this.lookup(model.textures, key);
    const isFlat = model.chain.some((m) => FLAT_PARENTS.has(m));
    const isCross = model.chain.some((m) => CROSS_PARENTS.has(m));
    const isBlock = forceBlock || model.chain.some((m) => m.split(":")[1]?.startsWith("block/"));

    if (isCross) {
      const cross = await this.texture(tex("cross") ?? tex("plant") ?? tex("particle"));
      if (cross) return { kind: "flat", layers: [cross] };
    }
    if (isFlat || (!isBlock && tex("layer0"))) {
      const layers: Texture[] = [];
      for (let i = 0; i < 5; i++) {
        const t = await this.texture(tex(`layer${i}`));
        if (t) layers.push(t);
        else if (i > 0) break;
      }
      if (layers.length > 0) return { kind: "flat", layers };
    }
    // Real geometry: draw the elements like the inventory does.
    if (model.elements?.length) {
      const elements = await this.loadElements(model);
      if (elements.length > 0) return { kind: "model", elements, rotation: model.guiRotation ?? [30, 225, 0] };
    }
    // Geometry built by mod code: its textures are UV atlases, a guess would look broken.
    if (model.loader) return null;
    if (isBlock) {
      const pick = (...keys: string[]) => keys.map(tex).find((t) => t !== undefined);
      // Models built from elements often use arbitrary keys like "0" or "1".
      const anyKey = Object.keys(model.textures).map(tex).find((t) => t !== undefined);
      const fallback = pick("all", "side", "texture", "particle") ?? anyKey;
      const top = await this.texture(pick("top", "up", "end", "all") ?? fallback);
      const left = await this.texture(pick("front", "north", "side", "all") ?? fallback);
      const right = await this.texture(pick("side", "east", "south", "all") ?? fallback);
      if (top && left && right) return { kind: "cube", top, left, right };
      const any = top ?? left ?? right;
      if (any) return { kind: "flat", layers: [any] };
    }
    const particle = await this.texture(tex("particle"));
    return particle ? { kind: "flat", layers: [particle] } : null;
  }

  /** First model referenced by `blockstates/<path>.json` (variants or multipart). */
  private async blockstateModel(ns: string, path: string): Promise<string | null> {
    type Variant = { model?: string } | { model?: string }[];
    const state = await this.index.json<{ variants?: Record<string, Variant>; multipart?: { apply?: Variant }[] }>(
      `assets/${ns}/blockstates/${path}.json`,
    );
    const first = (v: Variant | undefined) => (Array.isArray(v) ? v[0]?.model : v?.model);
    const model = first(Object.values(state?.variants ?? {})[0]) ?? first(state?.multipart?.[0]?.apply);
    return model ?? null;
  }

  /** Follows `parent` links, merging textures (children override parents). */
  private async resolveModel(ref: string): Promise<ResolvedModel | null> {
    const resolved: ResolvedModel = { chain: [], textures: {}, loader: false };
    let current: string | undefined = qualify(ref);
    while (current && resolved.chain.length < 16 && !resolved.chain.includes(current)) {
      const [ns, path] = split(current);
      const model: Model | null = await this.index.json<Model>(`assets/${ns}/models/${path}.json`);
      resolved.chain.push(current);
      if (!model) {
        if (resolved.chain.length === 1) return null;
        break; // built-in parents such as builtin/generated have no file
      }
      for (const [k, v] of Object.entries(model.textures ?? {})) if (!(k in resolved.textures) && typeof v === "string") resolved.textures[k] = v;
      if (!resolved.elements && Array.isArray(model.elements)) resolved.elements = model.elements;
      if (!resolved.guiRotation && Array.isArray(model.display?.gui?.rotation)) resolved.guiRotation = model.display!.gui!.rotation;
      if (typeof model.loader === "string" && !model.loader.startsWith("minecraft:")) resolved.loader = true;
      current = typeof model.parent === "string" ? qualify(model.parent) : undefined;
    }
    return resolved;
  }

  /** Loads the textures of a model's elements (faces whose texture is missing are dropped). */
  private async loadElements(model: ResolvedModel): Promise<ModelElement[]> {
    const out: ModelElement[] = [];
    for (const raw of (model.elements ?? []).slice(0, MAX_ELEMENTS)) {
      if (!Array.isArray(raw.from) || !Array.isArray(raw.to)) continue;
      const element: ModelElement = { from: raw.from, to: raw.to, faces: {} };
      const r = raw.rotation;
      if (r && typeof r.angle === "number" && r.angle !== 0 && (r.axis === "x" || r.axis === "y" || r.axis === "z")) {
        element.rotation = { origin: r.origin ?? [8, 8, 8], axis: r.axis, angle: r.angle };
      }
      for (const [name, face] of Object.entries(raw.faces ?? {}) as [FaceName, NonNullable<RawElement["faces"]>[FaceName]][]) {
        if (!face?.texture || name === "down") continue; // the bottom is never visible in the inventory view
        const texture = await this.texture(face.texture.startsWith("#") ? this.lookup(model.textures, face.texture.slice(1)) : qualify(face.texture));
        if (!texture) continue;
        const uv = Array.isArray(face.uv) && face.uv.length === 4 ? (face.uv as [number, number, number, number]) : defaultUv(name, raw.from, raw.to);
        element.faces[name] = { texture, uv, rotation: face.rotation ?? 0 };
      }
      if (Object.keys(element.faces).length > 0) out.push(element);
    }
    return out;
  }

  /** Resolves `#var` references inside a model's texture map. */
  private lookup(textures: Record<string, string>, key: string): string | undefined {
    let value = textures[key];
    for (let i = 0; value?.startsWith("#") && i < 8; i++) value = textures[value.slice(1)];
    return value && !value.startsWith("#") ? qualify(value) : undefined;
  }

  private textures = new Map<string, Promise<Texture | null>>();

  private texture(ref: string | undefined): Promise<Texture | null> {
    if (!ref) return Promise.resolve(null);
    const [ns, path] = split(qualify(ref));
    const key = `${ns}:${path}`;
    let cached = this.textures.get(key);
    if (!cached) {
      cached = this.index.bytes(`assets/${ns}/textures/${path}.png`).then((png) => (png ? (FOLIAGE.test(path) ? { png, tint: FOLIAGE_COLOR } : { png }) : null));
      this.textures.set(key, cached);
    }
    return cached;
  }
}
