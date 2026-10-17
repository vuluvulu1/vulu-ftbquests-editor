import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { AssetIndex } from "../src/core/assets/assetIndex";
import { ItemAssets, prettifyId } from "../src/core/assets/items";
import { folderArchive, zipArchive } from "../src/core/assets/sources";
import { readZipDirectory, readZipEntry, type RandomAccessFile } from "../src/core/assets/zip";

/** Builds a zip in memory: entries are deflated unless their name ends in ".stored". */
function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const stored = name.endsWith(".stored");
    const data = stored ? raw : new Uint8Array(deflateRawSync(raw));
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function memFile(bytes: Uint8Array, name = "test.jar"): RandomAccessFile {
  return { name, size: async () => bytes.length, read: async (o, l) => bytes.slice(o, o + l) };
}

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

describe("zip reader", () => {
  it("reads stored and deflated entries", async () => {
    const big = "x".repeat(5000);
    const file = memFile(makeZip({ "a.txt.stored": "hello", "dir/b.txt": big }));
    const entries = await readZipDirectory(file);
    expect(entries.map((e) => e.name)).toEqual(["a.txt.stored", "dir/b.txt"]);
    expect(text(await readZipEntry(file, entries[0]!))).toBe("hello");
    expect(text(await readZipEntry(file, entries[1]!))).toBe(big);
    expect(entries[1]!.compressedSize).toBeLessThan(big.length);
  });

  it("rejects files that are not zips", async () => {
    await expect(readZipDirectory(memFile(new TextEncoder().encode("not a zip at all, sorry")))).rejects.toThrow(/ZIP/);
  });
});

describe("asset index", () => {
  it("lets later archives override earlier ones and skips irrelevant files", async () => {
    const vanilla = zipArchive(memFile(makeZip({ "assets/minecraft/lang/en_us.json": '{"a":"vanilla"}', "net/Foo.class": "x" })));
    const pack = folderArchive("pack", ["assets/minecraft/lang/en_us.json"], async () => new TextEncoder().encode('{"a":"pack"}'));
    const index = await AssetIndex.build([vanilla, pack]);
    expect(index.size).toBe(1);
    expect(await index.json("assets/minecraft/lang/en_us.json")).toEqual({ a: "pack" });
  });

  it("keeps going when one archive is broken", async () => {
    const good = zipArchive(memFile(makeZip({ "assets/x/lang/en_us.json": "{}" })));
    const bad = zipArchive(memFile(new Uint8Array(10), "broken.jar"));
    const index = await AssetIndex.build([good, bad]);
    expect(index.archives).toBe(1);
    expect(index.issues.map((i) => i.file)).toEqual(["broken.jar"]);
  });
});

describe("item resolution", () => {
  const png = (tag: string) => new TextEncoder().encode(`PNG:${tag}`);
  const json = (v: unknown) => JSON.stringify(v);

  async function assets(files: Record<string, string | Uint8Array>) {
    return new ItemAssets(await AssetIndex.build([zipArchive(memFile(makeZip(files)))]));
  }
  const tag = (t: { png: Uint8Array } | undefined) => (t ? new TextDecoder().decode(t.png) : undefined);

  it("handles generated items, cube blocks, cross plants and #references", async () => {
    const a = await assets({
      "assets/minecraft/models/item/generated.json": json({ parent: "builtin/generated" }),
      "assets/minecraft/models/item/diamond.json": json({ parent: "item/generated", textures: { layer0: "item/diamond" } }),
      "assets/minecraft/textures/item/diamond.png": png("diamond"),
      "assets/minecraft/models/block/cube_all.json": json({ parent: "block/cube", textures: { particle: "#all" } }),
      "assets/minecraft/models/block/cube.json": json({ textures: { up: "#top" } }),
      "assets/mymod/models/item/ore.json": json({ parent: "mymod:block/ore" }),
      "assets/mymod/models/block/ore.json": json({ parent: "minecraft:block/cube_all", textures: { all: "mymod:block/ore" } }),
      "assets/mymod/textures/block/ore.png": png("ore"),
      "assets/minecraft/models/item/poppy.json": json({ parent: "item/generated", textures: { layer0: "block/poppy" } }),
      "assets/minecraft/textures/block/poppy.png": png("poppy"),
      "assets/minecraft/models/item/fern.json": json({ parent: "block/fern" }),
      "assets/minecraft/models/block/fern.json": json({ parent: "block/tinted_cross", textures: { cross: "block/fern" } }),
      "assets/minecraft/models/block/tinted_cross.json": json({}),
      "assets/minecraft/textures/block/fern.png": png("fern"),
    });

    const diamond = await a.icon("minecraft:diamond");
    expect(diamond?.kind).toBe("flat");
    expect(diamond?.kind === "flat" && tag(diamond.layers[0])).toBe("PNG:diamond");

    const ore = await a.icon("mymod:ore");
    expect(ore?.kind).toBe("cube");
    expect(ore?.kind === "cube" && [tag(ore.top), tag(ore.left), tag(ore.right)]).toEqual(["PNG:ore", "PNG:ore", "PNG:ore"]);

    const fern = await a.icon("minecraft:fern");
    expect(fern?.kind === "flat" && fern.layers[0]?.tint).toBeTruthy(); // foliage is tinted green
  });

  it("falls back to the blockstate model and to texture names", async () => {
    const a = await assets({
      "assets/geo/models/item/relay.json": json({ parent: "builtin/entity" }),
      "assets/geo/blockstates/relay.json": json({ variants: { "facing=north": { model: "geo:block/relay" } } }),
      "assets/geo/models/block/relay.json": json({ textures: { particle: "geo:block/relay_side" } }),
      "assets/geo/textures/block/relay_side.png": png("relay"),
      "assets/plain/textures/item/coin.png": png("coin"),
    });
    const relay = await a.icon("geo:relay");
    expect(relay && (relay.kind === "flat" ? tag(relay.layers[0]) : relay.kind === "cube" ? tag(relay.top) : undefined)).toBe("PNG:relay");
    expect((await a.icon("plain:coin"))?.kind).toBe("flat");
    expect(await a.icon("plain:nothing")).toBeNull();
  });

  it("resolves Blockbench-style element models with their UVs and GUI rotation", async () => {
    const a = await assets({
      "assets/bb/models/item/machine.json": json({
        textures: { "0": "bb:block/atlas" },
        display: { gui: { rotation: [30, 45, 0] } },
        elements: [
          { from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: "#0", uv: [0, 0, 8, 8] }, north: { texture: "#0" }, down: { texture: "#0" } } },
        ],
      }),
      "assets/bb/textures/block/atlas.png": png("atlas"),
    });
    const icon = await a.icon("bb:machine");
    expect(icon?.kind).toBe("model");
    if (icon?.kind !== "model") return;
    expect(icon.rotation).toEqual([30, 45, 0]);
    const faces = icon.elements[0]!.faces;
    expect(Object.keys(faces).sort()).toEqual(["north", "up"]); // the bottom is never visible
    expect(faces.up!.uv).toEqual([0, 0, 8, 8]);
    expect(faces.north!.uv).toEqual([0, 8, 16, 16]); // Minecraft's default UV from the element bounds
    expect(tag(faces.up!.texture)).toBe("PNG:atlas");
  });

  it("does not guess an icon for models built by mod code (custom loaders)", async () => {
    const a = await assets({
      "assets/bags/models/item/backpack.json": json({ parent: "bags:block/backpack" }),
      "assets/bags/models/block/backpack.json": json({ loader: "bags:backpack", textures: { clips: "bags:block/leather_clips" } }),
      "assets/bags/textures/block/leather_clips.png": png("clips"),
    });
    expect(await a.icon("bags:backpack")).toBeNull();
  });

  it("draws FTB custom icons from either path form", async () => {
    const a = await assets({
      "assets/kubejs/textures/item/hat.png": png("hat"),
      "assets/apotheosis/textures/items/gems/surge.png": png("surge"),
    });
    const hat = await a.icon("texture:kubejs:textures/item/hat.png");
    const surge = await a.icon("texture:apotheosis:items/gems/surge");
    expect(hat?.kind === "flat" && tag(hat.layers[0])).toBe("PNG:hat");
    expect(surge?.kind === "flat" && tag(surge.layers[0])).toBe("PNG:surge");
  });

  it("reads names from lang files with a readable fallback", async () => {
    const a = await assets({
      "assets/minecraft/lang/en_us.json": json({ "block.minecraft.oak_log": "Oak Log", "item.minecraft.diamond": "Diamond" }),
    });
    expect(await a.name("minecraft:oak_log")).toBe("Oak Log");
    expect(await a.name("minecraft:diamond")).toBe("Diamond");
    expect(await a.name("minecraft:unknown")).toBeNull();
    expect(prettifyId("ars_nouveau:glyph_leap")).toBe("Glyph Leap");
  });
});
