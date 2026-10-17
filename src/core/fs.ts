import type { AssetArchive } from "./assets/sources";

/**
 * Access to a `config/ftbquests/quests` folder. Paths are relative to that folder
 * and always use "/" as the separator. Implementations exist for Tauri (desktop),
 * the browser File System Access API and memory (tests / demo).
 */
export interface QuestFileSystem {
  readonly label: string;
  /** Every file under the quests root, recursively. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  /** Creates missing parent folders. */
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * Copies the current folder somewhere safe before saving; returns where it went.
   * `instanceFiles` are extra instance-relative files about to be written (lang files).
   */
  backup?(instanceFiles?: string[]): Promise<string>;
  /**
   * Files of the instance outside the quests folder, relative to the instance
   * (e.g. `kubejs/assets/modpack/lang/en_us.json`). Only `kubejs/**.json` is allowed.
   */
  readInstanceFile?(path: string): Promise<string | null>;
  writeInstanceFile?(path: string, content: string): Promise<void>;
  /** Binary instance files; only `kubejs/assets/<ns>/textures/**.png` (images added to chapters). */
  writeInstanceBinary?(path: string, content: Uint8Array): Promise<void>;
  /** Mod jars and other sources for item icons and names, when the instance folder is reachable. */
  assets?(): Promise<AssetBundle | null>;
}

export interface AssetBundle {
  /** Lowest priority first (vanilla, mods, kubejs, resource packs). */
  archives: AssetArchive[];
  version?: string;
  vanilla: boolean;
}

/** Instance files the editor may write: lang files of KubeJS's resource folder. */
export function isEditableInstanceFile(path: string): boolean {
  return /^kubejs\/assets\/[a-z0-9_.-]+\/lang\/[a-z_]+\.json$/.test(path);
}

/** Textures the editor may add: PNGs under KubeJS's resource folder, Minecraft-style lowercase paths. */
export function isEditableInstanceTexture(path: string): boolean {
  return /^kubejs\/assets\/[a-z0-9_.-]+\/textures\/[a-z0-9_.\/-]+\.png$/.test(path) && !path.includes("..");
}

export class MemoryFileSystem implements QuestFileSystem {
  readonly binaries = new Map<string, Uint8Array>();

  async writeInstanceBinary(path: string, content: Uint8Array) {
    if (!isEditableInstanceTexture(path)) throw new Error(`Yazılamaz: ${path}`);
    this.binaries.set(path, content);
  }

  readonly files: Map<string, string>;
  readonly instanceFiles: Map<string, string>;

  constructor(
    files: Record<string, string> = {},
    readonly label = "memory",
    instanceFiles: Record<string, string> = {},
  ) {
    this.files = new Map(Object.entries(files));
    this.instanceFiles = new Map(Object.entries(instanceFiles));
  }

  async readInstanceFile(path: string) {
    return this.instanceFiles.get(path) ?? null;
  }

  async writeInstanceFile(path: string, content: string) {
    if (!isEditableInstanceFile(path)) throw new Error(`Yazılamaz: ${path}`);
    this.instanceFiles.set(path, content);
  }

  async list() {
    return [...this.files.keys()];
  }

  async read(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`File not found: ${path}`);
    return text;
  }

  async write(path: string, content: string) {
    this.files.set(path, content);
  }

  async remove(path: string) {
    this.files.delete(path);
  }
}
