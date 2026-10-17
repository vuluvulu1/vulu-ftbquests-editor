import type { AssetArchive } from "./sources";

/** Only entries needed for item icons and names are indexed. */
export const RELEVANT_ASSET = /^assets\/[^/]+\/(models\/.+\.json|blockstates\/.+\.json|textures\/.+\.png|lang\/[a-z_]+\.json)$/;
const CONCURRENCY = 8;

export interface AssetLoadProgress {
  done: number;
  total: number;
}

export interface AssetLoadIssue {
  file: string;
  message: string;
}

/**
 * A merged view of `assets/` across many archives, like Minecraft's resource manager:
 * archives later in the list win, so pass vanilla first, then mods, then overrides.
 */
export class AssetIndex {
  private entries = new Map<string, AssetArchive>();
  private jsonCache = new Map<string, Promise<unknown>>();
  readonly issues: AssetLoadIssue[] = [];
  archives = 0;
  private writableArchives = 0;

  static async build(archives: AssetArchive[], onProgress?: (p: AssetLoadProgress) => void): Promise<AssetIndex> {
    const index = new AssetIndex();
    const listed: (string[] | undefined)[] = new Array(archives.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < archives.length) {
        const i = next++;
        try {
          listed[i] = (await archives[i]!.list()).filter((n) => RELEVANT_ASSET.test(n));
        } catch (e) {
          index.issues.push({ file: archives[i]!.name, message: e instanceof Error ? e.message : String(e) });
        }
        onProgress?.({ done: ++done, total: archives.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, archives.length) }, worker));

    // Apply in priority order regardless of which listing finished first.
    archives.forEach((archive, i) => {
      if (!listed[i]) return;
      index.archives++;
      if (archive.instancePath) index.writableArchives++;
      for (const path of listed[i]) index.entries.set(path, archive);
    });
    return index;
  }

  get size() {
    return this.entries.size;
  }

  has(path: string) {
    return this.entries.has(path);
  }

  /** Shows a file that is not on disk yet (an image added but not saved) as if it were in `instancePath`. */
  putFile(path: string, bytes: Uint8Array, instancePath?: string) {
    this.entries.set(path, { name: "eklenen dosyalar", instancePath, list: async () => [path], read: async () => bytes });
    this.jsonCache.delete(path);
  }

  /** Namespaces that already have textures in a writable archive (the pack's own KubeJS assets). */
  writableTextureNamespaces(): string[] {
    const counts = new Map<string, number>();
    for (const [path, archive] of this.entries) {
      const m = /^assets\/([^/]+)\/textures\//.exec(path);
      if (m && archive.instancePath) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([ns]) => ns);
  }

  /** True when some source is the instance's KubeJS folder, i.e. added textures will load in game. */
  get hasWritableSource(): boolean {
    return this.writableArchives > 0;
  }

  /** Instance-relative path of `path` when it lives in a writable archive (kubejs). */
  instancePath(path: string): string | undefined {
    const base = this.entries.get(path)?.instancePath;
    return base ? base + path : undefined;
  }

  paths(filter: (path: string) => boolean): string[] {
    return [...this.entries.keys()].filter(filter);
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const archive = this.entries.get(path);
    if (!archive) return null;
    try {
      return await archive.read(path);
    } catch {
      return null;
    }
  }

  /** Parsed JSON (cached). Returns null for missing or invalid files. */
  json<T = unknown>(path: string): Promise<T | null> {
    let cached = this.jsonCache.get(path);
    if (!cached) {
      cached = this.bytes(path).then((b) => {
        if (!b) return null;
        try {
          // TextDecoder drops a UTF-8 byte order mark by itself.
          return JSON.parse(new TextDecoder().decode(b));
        } catch {
          return null;
        }
      });
      this.jsonCache.set(path, cached);
    }
    return cached as Promise<T | null>;
  }
}
