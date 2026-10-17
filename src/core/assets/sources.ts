import { RELEVANT_ASSET } from "./assetIndex";
import { readZipDirectory, readZipEntry, type RandomAccessFile, type ZipEntry } from "./zip";

/** Something that holds `assets/...` files: a jar/zip or a loose folder (kubejs/, resource pack folders). */
export interface AssetArchive {
  readonly name: string;
  /** Instance-relative folder of a writable archive (`kubejs/`); lang edits go there. */
  readonly instancePath?: string;
  /** Paths inside the archive, e.g. `assets/minecraft/textures/item/diamond.png`. */
  list(): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
}

/** Keeps only icon-related entries by default; mod jars hold thousands of class files. */
export function zipArchive(file: RandomAccessFile, keep: (name: string) => boolean = (n) => RELEVANT_ASSET.test(n)): AssetArchive {
  let entries: Map<string, ZipEntry> | undefined;
  return {
    name: file.name,
    async list() {
      entries = new Map((await readZipDirectory(file, keep)).map((e) => [e.name, e]));
      return [...entries.keys()];
    },
    async read(path) {
      const entry = entries?.get(path);
      return entry ? readZipEntry(file, entry) : null;
    },
  };
}

export function folderArchive(
  name: string,
  files: string[],
  read: (path: string) => Promise<Uint8Array | null>,
  instancePath?: string,
): AssetArchive {
  return { name, instancePath, list: async () => files, read };
}

/**
 * Serializable description of an instance's asset sources, produced by the platform
 * (Rust command, dev server, Node) and turned into archives with an {@link AssetHost}.
 * Ordered from lowest to highest priority.
 */
export type AssetSourceSpec =
  | { kind: "zip"; id: string; name: string; size: number }
  | { kind: "dir"; id: string; name: string; files: string[] };

export interface InstanceAssetInfo {
  version?: string;
  /** Whether the vanilla client jar was found (otherwise `minecraft:` items have no icons). */
  vanilla: boolean;
  sources: AssetSourceSpec[];
}

export interface AssetHost {
  readRange(id: string, offset: number, length: number): Promise<Uint8Array>;
  readFile(id: string, path: string): Promise<Uint8Array | null>;
}

export function archivesFromSpecs(specs: AssetSourceSpec[], host: AssetHost, keep?: (name: string) => boolean): AssetArchive[] {
  return specs.map((s) =>
    s.kind === "zip"
      ? zipArchive({ name: s.name, size: async () => s.size, read: (o, l) => host.readRange(s.id, o, l) }, keep)
      : // The instance's kubejs folder is the only source whose lang files the editor writes to.
        folderArchive(s.name, s.files, (p) => host.readFile(s.id, p), s.name === "kubejs" ? "kubejs/" : undefined),
  );
}
