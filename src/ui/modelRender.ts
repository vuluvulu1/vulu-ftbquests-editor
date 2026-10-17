import type { FaceName, ItemIcon, ModelElement, Texture } from "../core/assets/items";

// Draws a Blockbench-style model (elements with per-face UVs) the way the inventory shows it:
// an isometric view for the usual [30, 225, 0] GUI rotation, or a straight front view when the
// model's GUI rotation does not tilt it. Faces are sorted back to front and shaded like Minecraft.

type V2 = [number, number];
type V3 = [number, number, number];
type ModelIcon = Extract<ItemIcon, { kind: "model" }>;

const SIDES: FaceName[] = ["north", "east", "south", "west"];
/** Brightness loss per face, as Minecraft shades block faces. */
const SHADE: Record<FaceName, number> = { up: 0, down: 0.5, north: 0.2, south: 0.2, east: 0.4, west: 0.4 };

/** Turns the model 90° around the vertical axis `k` times: (x, z) -> (16 - z, x), north -> east. */
function turnPoint(p: V3, k: number): V3 {
  let [x, y, z] = p;
  for (let i = 0; i < k; i++) [x, z] = [16 - z, x];
  return [x, y, z];
}

function turnFace(face: FaceName, k: number): FaceName {
  const i = SIDES.indexOf(face);
  return i < 0 ? face : SIDES[(i + k) % 4]!;
}

/** Element rotation (around one axis through `origin`). */
function rotatePoint(p: V3, r: NonNullable<ModelElement["rotation"]>): V3 {
  const a = (r.angle * Math.PI) / 180;
  const [ox, oy, oz] = r.origin;
  const [x, y, z] = [p[0] - ox, p[1] - oy, p[2] - oz];
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (r.axis === "x") return [x + ox, y * c - z * s + oy, y * s + z * c + oz];
  if (r.axis === "y") return [x * c + z * s + ox, y + oy, -x * s + z * c + oz];
  return [x * c - y * s + ox, x * s + y * c + oy, z + oz];
}

/** Texture corners (top-left, top-right, bottom-left) of each face, in model space. */
function faceCorners(face: FaceName, [fx, fy, fz]: V3, [tx, ty, tz]: V3): [V3, V3, V3] {
  switch (face) {
    case "up":
      return [[fx, ty, fz], [tx, ty, fz], [fx, ty, tz]];
    case "down":
      return [[fx, fy, tz], [tx, fy, tz], [fx, fy, fz]];
    case "north":
      return [[tx, ty, fz], [fx, ty, fz], [tx, fy, fz]];
    case "south":
      return [[fx, ty, tz], [tx, ty, tz], [fx, fy, tz]];
    case "west":
      return [[fx, ty, fz], [fx, ty, tz], [fx, fy, fz]];
    case "east":
      return [[tx, ty, tz], [tx, ty, fz], [tx, fy, tz]];
  }
}

interface Poly {
  /** Screen corners in drawing order (tl, tr, br, bl). */
  pts: V2[];
  o: V2;
  u: V2;
  v: V2;
  uv: [number, number, number, number];
  texture: Texture;
  shade: number;
  depth: number;
}

export async function drawModel(
  ctx: CanvasRenderingContext2D,
  icon: ModelIcon,
  size: number,
  load: (t: Texture, shade: number) => Promise<CanvasImageSource & { width: number; height: number }>,
) {
  const [rx, ry] = icon.rotation;
  const front = Math.abs(rx) < 10;
  const mod = (n: number) => ((n % 4) + 4) % 4;
  // [30, 225, 0] shows north on the left and west on the right: half a turn from our view of south/east.
  const k = front ? mod(Math.round(ry / 90)) : mod(Math.round((ry - 225) / 90) + 2);
  const visible = new Set<FaceName>(front ? ["south"] : ["up", "south", "east"]);
  const project = ([x, y, z]: V3): V2 => (front ? [x, 16 - y] : [x - z, (x + z) / 2 + (16 - y)]);
  const depthOf = ([x, y, z]: V3) => (front ? z : x + y + z);

  const polys: Poly[] = [];
  for (const el of icon.elements) {
    for (const [name, face] of Object.entries(el.faces) as [FaceName, NonNullable<ModelElement["faces"][FaceName]>][]) {
      const shown = turnFace(name, k);
      if (!visible.has(shown)) continue;
      const place = (p: V3) => turnPoint(el.rotation ? rotatePoint(p, el.rotation) : p, k);
      const [tl, tr, bl] = faceCorners(name, el.from, el.to).map(place) as [V3, V3, V3];
      const br: V3 = [tr[0] + bl[0] - tl[0], tr[1] + bl[1] - tl[1], tr[2] + bl[2] - tl[2]];
      const corners = [tl, tr, br, bl].map(project);
      // A rotated UV starts the texture at another corner.
      const r = mod(Math.round(face.rotation / 90));
      const o = corners[r]!;
      const a = corners[(r + 1) % 4]!;
      const b = corners[(r + 3) % 4]!;
      polys.push({
        pts: corners,
        o,
        u: [a[0] - o[0], a[1] - o[1]],
        v: [b[0] - o[0], b[1] - o[1]],
        uv: face.uv,
        texture: face.texture,
        shade: SHADE[shown],
        depth: (depthOf(tl) + depthOf(br)) / 2,
      });
    }
  }
  if (polys.length === 0) return false;

  // Fit everything into the icon, centred.
  const xs = polys.flatMap((p) => p.pts.map((q) => q[0]));
  const ys = polys.flatMap((p) => p.pts.map((q) => q[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = size * 0.04;
  const scale = Math.min((size - 2 * pad) / (maxX - minX || 1), (size - 2 * pad) / (maxY - minY || 1));
  const offX = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const offY = (size - (maxY - minY) * scale) / 2 - minY * scale;
  const fit = (p: V2): V2 => [p[0] * scale + offX, p[1] * scale + offY];

  polys.sort((a, b) => a.depth - b.depth);
  for (const p of polys) {
    const img = await load(p.texture, p.shade);
    const [u1, v1, u2, v2] = p.uv;
    const du = u2 - u1 || 0.01;
    const dv = v2 - v1 || 0.01;
    const o = fit(p.o);
    const u: V2 = [p.u[0] * scale, p.u[1] * scale];
    const v: V2 = [p.v[0] * scale, p.v[1] * scale];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    p.pts.map(fit).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    // texture space (0..16 on both axes) -> screen
    const ta = u[0] / du;
    const tb = u[1] / du;
    const tc = v[0] / dv;
    const td = v[1] / dv;
    ctx.setTransform(ta, tb, tc, td, o[0] - u1 * ta - v1 * tc, o[1] - u1 * tb - v1 * td);
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 16, 16);
    ctx.restore();
  }
  return true;
}
