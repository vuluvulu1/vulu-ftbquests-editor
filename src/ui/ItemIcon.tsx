import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { prettifyId, type ItemAssets, type ItemIcon as Icon, type Texture } from "../core/assets/items";
import { drawModel } from "./modelRender";

// Draws resolved item icons to data URLs (flat sprites or an isometric block like the
// inventory shows) and exposes them to React with per-ItemAssets caches.

export const AssetsContext = createContext<ItemAssets | null>(null);

const SIZE = 64;

async function bitmap(tex: Texture): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(new Blob([tex.png as BlobPart], { type: "image/png" }));
  // Animated textures are vertical strips: keep the first square frame. Other non-square
  // textures (model UV atlases like 64x32) are kept whole.
  const w = img.width;
  const h = img.height > w && img.height % w === 0 ? w : img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  if (tex.tint) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = tex.tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in"; // restore the original transparency
    ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  }
  img.close();
  return canvas;
}

/** Darkens opaque pixels only, so transparent parts (glass, leaves) stay transparent. */
function shaded(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  if (amount === 0) return src;
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(0,0,0,${amount})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

async function render(icon: Icon): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  if (icon.kind === "flat") {
    for (const layer of icon.layers) ctx.drawImage(await bitmap(layer), 0, 0, SIZE, SIZE);
    return canvas.toDataURL();
  }

  if (icon.kind === "model") {
    const loaded = new Map<Texture, Promise<HTMLCanvasElement>>();
    const load = async (t: Texture, shade: number) => {
      let base = loaded.get(t);
      if (!base) loaded.set(t, (base = bitmap(t)));
      return shaded(await base, shade);
    };
    await drawModel(ctx, icon, SIZE, load);
    return canvas.toDataURL();
  }

  // Isometric cube: each face maps the unit square through an affine transform.
  const s = SIZE;
  const faces: [HTMLCanvasElement, number[]][] = [
    [await bitmap(icon.top), [s / 2, s / 4, -s / 2, s / 4, s / 2, 0]],
    [shaded(await bitmap(icon.left), 0.2), [s / 2, s / 4, 0, s / 2, 0, s / 4]],
    [shaded(await bitmap(icon.right), 0.4), [s / 2, -s / 4, 0, s / 2, s / 2, s / 2]],
  ];
  for (const [img, [a, b, c, d, e, f]] of faces) {
    ctx.setTransform(a!, b!, c!, d!, e!, f!);
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 1, 1);
  }
  return canvas.toDataURL();
}

const urlCache = new WeakMap<ItemAssets, Map<string, Promise<string | null>>>();
const resolvedUrls = new WeakMap<ItemAssets, Map<string, string | null>>();

function iconUrl(assets: ItemAssets, id: string): Promise<string | null> {
  let cache = urlCache.get(assets);
  if (!cache) urlCache.set(assets, (cache = new Map()));
  let url = cache.get(id);
  if (!url) {
    url = assets
      .icon(id)
      .then((icon) => (icon ? render(icon) : null))
      .catch(() => null);
    url.then((u) => {
      let done = resolvedUrls.get(assets);
      if (!done) resolvedUrls.set(assets, (done = new Map()));
      done.set(id, u);
    });
    cache.set(id, url);
  }
  return url;
}

const SHAPE_OUTLINE = /^assets\/ftbquests\/textures\/shapes\/([^/]+)\/outline\.png$/;

/** Quest shapes with textures in the pack (FTB's own plus any a resource pack adds). */
export function availableShapes(assets: ItemAssets | null): string[] {
  return assets ? assets.index.paths((p) => SHAPE_OUTLINE.test(p)).map((p) => SHAPE_OUTLINE.exec(p)![1]!) : [];
}

/** Shape choices for dropdowns: "" (inherit) first, then known and pack-provided shapes. */
export function useShapeOptions(base: string[]): string[] {
  const assets = useContext(AssetsContext);
  return useMemo(() => ["", ...new Set([...base.filter(Boolean), ...availableShapes(assets).sort()])], [assets, base]);
}

/** Texture refs of every shape's background and outline, for preloading. */
export function shapeTextureRefs(assets: ItemAssets): string[] {
  return availableShapes(assets).flatMap((s) => [
    `texture:ftbquests:textures/shapes/${s}/background.png`,
    `texture:ftbquests:textures/shapes/${s}/outline.png`,
  ]);
}

/** Resolves and draws icons ahead of time so they appear instantly later. */
export async function preloadIcons(assets: ItemAssets, ids: Iterable<string>, onProgress?: (done: number, total: number) => void) {
  const list = [...new Set(ids)];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < list.length) {
      await iconUrl(assets, list[next++]!);
      onProgress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, list.length) }, worker));
}

export function useItemIcon(id: string | undefined): string | null | undefined {
  const assets = useContext(AssetsContext);
  const known = assets && id ? resolvedUrls.get(assets)?.get(id) : undefined;
  const [url, setUrl] = useState<string | null | undefined>(known);
  useEffect(() => {
    if (!assets || !id) return setUrl(undefined);
    let alive = true;
    setUrl(resolvedUrls.get(assets)?.get(id));
    void iconUrl(assets, id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [assets, id]);
  return url;
}

/** Display name from the mods' lang files; null while unknown. */
export function useItemName(id: string | undefined): string | null {
  const assets = useContext(AssetsContext);
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!assets || !id) return setName(null);
    let alive = true;
    void assets.name(id).then((n) => alive && setName(n));
    return () => {
      alive = false;
    };
  }, [assets, id]);
  return name;
}

const imageUrls = new WeakMap<ItemAssets, Map<string, Promise<string | null>>>();

/**
 * Full-size image for chapter decorations (not squashed into a 64px icon). Animated
 * strips are cut to their first frame so they show like in game.
 */
export function useTextureImage(ref: string | undefined): string | null | undefined {
  const assets = useContext(AssetsContext);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!assets || !ref) return setUrl(undefined);
    let cache = imageUrls.get(assets);
    if (!cache) imageUrls.set(assets, (cache = new Map()));
    let pending = cache.get(ref);
    if (!pending) {
      pending = assets.textureBytes(ref).then(async (png) => {
        if (!png) return null;
        const blob = new Blob([png as BlobPart], { type: "image/png" });
        const img = await createImageBitmap(blob);
        const frames = img.height > img.width && img.height % img.width === 0;
        img.close();
        if (!frames) return URL.createObjectURL(blob);
        return render({ kind: "flat", layers: [{ png }] }); // first frame only
      }).catch(() => null);
      cache.set(ref, pending);
    }
    let alive = true;
    void pending.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [assets, ref]);
  return url;
}

/** Puts the pack's FTB background texture (ftb_quests_theme "background") behind the whole app. */
export function ThemeBackdrop() {
  const url = useItemIcon("texture:ftblibrary:textures/gui/background_squares.png");
  useEffect(() => {
    const root = document.documentElement.style;
    if (url) root.setProperty("--ftb-bg", `url(${url})`);
    else root.removeProperty("--ftb-bg");
  }, [url]);
  return null;
}

/** Item icon, or a short text placeholder when no texture could be found. */
export function ItemIcon({ id, size = 24, fallback }: { id: string | undefined; size?: number; fallback?: string }) {
  const url = useItemIcon(id);
  if (url) return <img className="item-icon" src={url} width={size} height={size} alt={id} draggable={false} />;
  const text = fallback ?? (id ? (id.split(":").pop() ?? id) : "");
  return (
    <span className="item-icon-missing" style={{ width: size, height: size, fontSize: Math.max(8, size / 4.5) }} title={id}>
      {text.slice(0, 10)}
    </span>
  );
}

/** "Oak Log" when known, otherwise a readable form of the id. */
export function ItemName({ id }: { id: string }) {
  return <>{useItemName(id) ?? prettifyId(id)}</>;
}
