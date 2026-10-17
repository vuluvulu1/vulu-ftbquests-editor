import type { AssetIndex } from "./assets/assetIndex";
import type { QuestBook } from "./book";

// Adds a PNG from the user's computer to the pack as a KubeJS texture, so it can be used
// as a chapter image: kubejs/assets/<ns>/textures/quest_images/<name>.png

export interface ImportedImage {
  /** Image reference to store in the chapter, e.g. `modpack:textures/quest_images/letter.png`. */
  ref: string;
  /** Pixel size, used to keep the aspect ratio. */
  width: number;
  height: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TR: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };

/** Width and height from the IHDR chunk; throws if the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) throw new Error("Bu dosya bir PNG değil.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Minecraft resource names: lowercase a-z, 0-9, _ - . only. */
export function resourceName(fileName: string): string {
  return (
    fileName
      .replace(/\.png$/i, "")
      .toLocaleLowerCase("tr")
      .replace(/[çğıöşü]/g, (c) => TR[c]!)
      .normalize("NFKD")
      .replace(/[^a-z0-9_.-]+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "") || "image"
  );
}

export function importPng(book: QuestBook, index: AssetIndex, fileName: string, bytes: Uint8Array): ImportedImage {
  const { width, height } = pngSize(bytes);
  if (!index.hasWritableSource) {
    throw new Error("Bu pakette KubeJS'in assets klasörü yok; eklenen resim oyunda yüklenmez.");
  }
  const ns = index.writableTextureNamespaces()[0] ?? "kubejs";
  const base = resourceName(fileName);
  const assetPath = (name: string) => `assets/${ns}/textures/quest_images/${name}.png`;
  let name = base;
  for (let i = 2; index.has(assetPath(name)) || book.hasPendingFile(`kubejs/${assetPath(name)}`); i++) name = `${base}_${i}`;

  book.addInstanceTexture(`kubejs/${assetPath(name)}`, bytes);
  index.putFile(assetPath(name), bytes, "kubejs/");
  return { ref: `${ns}:textures/quest_images/${name}.png`, width, height };
}

/** Grid size for a new image: longest side ~ pixels/32, between 1 and 6 quest units. */
export function initialImageSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.min(6, Math.max(1, Math.max(width, height) / 32));
  const round = (v: number) => Math.round(v * 100) / 100;
  return width >= height ? { width: round(longest), height: round((longest * height) / width) } : { width: round((longest * width) / height), height: round(longest) };
}
