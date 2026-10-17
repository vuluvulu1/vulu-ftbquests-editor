import { describe, expect, it } from "vitest";
import { AssetIndex } from "../src/core/assets/assetIndex";
import { folderArchive } from "../src/core/assets/sources";
import { QuestBook } from "../src/core/book";
import { MemoryFileSystem } from "../src/core/fs";
import { importPng, initialImageSize, pngSize, resourceName } from "../src/core/imageImport";

/** Minimal PNG header (signature + IHDR) with the given size; enough for pngSize. */
function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const DATA = '{\n\tid: "0000000000000001"\n}\n';
const CHAPTER = '{\n\tid: "1111111111111111"\n\tquests: [ ]\n}\n';

async function setup(withKubejs = true) {
  const fs = new MemoryFileSystem({ "data.snbt": DATA, "chapters/c.snbt": CHAPTER });
  const book = await QuestBook.load(fs);
  const archives = withKubejs
    ? [folderArchive("kubejs", ["assets/modpack/textures/opened_letter.png"], async () => fakePng(1, 1), "kubejs/")]
    : [];
  const index = await AssetIndex.build(archives);
  return { fs, book, index };
}

describe("png helpers", () => {
  it("reads the size and rejects non-PNG files", () => {
    expect(pngSize(fakePng(320, 200))).toEqual({ width: 320, height: 200 });
    expect(() => pngSize(new TextEncoder().encode("GIF89a not a png at all...."))).toThrow(/PNG/);
  });

  it("makes Minecraft-safe resource names", () => {
    expect(resourceName("Açık Mektup!.PNG")).toBe("acik_mektup");
    expect(resourceName("ŞEKİL 2.png")).toBe("sekil_2");
    expect(resourceName("....png")).toBe("image");
  });

  it("sizes new images by their longest side, keeping the aspect ratio", () => {
    expect(initialImageSize(320, 160)).toEqual({ width: 6, height: 3 });
    expect(initialImageSize(16, 32)).toEqual({ width: 0.5, height: 1 });
    expect(initialImageSize(64, 128)).toEqual({ width: 2, height: 4 });
  });
});

describe("importPng", () => {
  it("adds the PNG to the pack's KubeJS namespace with a unique name, written on save", async () => {
    const { fs, book, index } = await setup();
    const first = importPng(book, index, "Mektup.png", fakePng(64, 32));
    const second = importPng(book, index, "mektup.png", fakePng(64, 32));
    expect(first.ref).toBe("modpack:textures/quest_images/mektup.png");
    expect(second.ref).toBe("modpack:textures/quest_images/mektup_2.png");
    expect(index.has("assets/modpack/textures/quest_images/mektup.png")).toBe(true); // visible before saving
    expect(book.dirty).toBe(true);

    book.addImage(book.chapters[0]!, first.ref, 0, 0, 2, 1);
    const result = await book.save();
    expect(result.written).toContain("instance:kubejs/assets/modpack/textures/quest_images/mektup.png");
    expect(fs.binaries.get("kubejs/assets/modpack/textures/quest_images/mektup.png")).toBeDefined();
    expect(fs.files.get("chapters/c.snbt")).toContain("modpack:textures/quest_images/mektup.png");
    expect(book.dirty).toBe(false);
  });

  it("refuses packs without KubeJS assets, where the image would never load", async () => {
    const { book, index } = await setup(false);
    expect(() => importPng(book, index, "x.png", fakePng(8, 8))).toThrow(/KubeJS/);
  });
});
