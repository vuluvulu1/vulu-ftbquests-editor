import { folderArchive, zipArchive, type AssetArchive } from "../core/assets/sources";
import { blobFile } from "../core/assets/zip";
import { isEditableInstanceFile, isEditableInstanceTexture, type AssetBundle, type QuestFileSystem } from "../core/fs";
import { t } from "../i18n";

// File System Access API (Chrome / Edge). Lets the editor run as a plain web page.

declare global {
  interface Window {
    showDirectoryPicker?(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

async function childDir(dir: FileSystemDirectoryHandle, name: string) {
  try {
    return await dir.getDirectoryHandle(name);
  } catch {
    return undefined;
  }
}

async function hasFile(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * The picked folder must be the instance: the browser cannot walk up to it from a
 * subfolder, and mods (for icons and names) are only reachable from there.
 * Returns the quests folder plus its parent, which is where backups go.
 */
async function resolveRoot(picked: FileSystemDirectoryHandle) {
  let parent: FileSystemDirectoryHandle | undefined = picked;
  for (const name of ["config", "ftbquests"]) parent = parent && (await childDir(parent, name));
  const root = parent && (await childDir(parent, "quests"));
  if (root && (await hasFile(root, "data.snbt"))) {
    return { root, parent, instance: picked, path: `${picked.name}/config/ftbquests/quests` };
  }
  return undefined;
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[]) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") out.push(prefix + name);
    else await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`, out);
  }
}

async function dirFor(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  const parts = path.split("/");
  const file = parts.pop()!;
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, file };
}

async function writeFile(root: FileSystemDirectoryHandle, path: string, content: string | Uint8Array) {
  const { dir, file } = await dirFor(root, path, true);
  const writable = await (await dir.getFileHandle(file, { create: true })).createWritable();
  await writable.write(content as FileSystemWriteChunkType);
  await writable.close();
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function browserFsSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export async function openBrowserFolder(): Promise<QuestFileSystem | undefined> {
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await window.showDirectoryPicker!({ id: "ftbquests", mode: "readwrite" });
  } catch {
    return undefined; // cancelled
  }
  const resolved = await resolveRoot(picked);
  if (!resolved) {
    throw new Error(t("No FTB Quests found in this folder. Choose the modpack's instance folder (the one with mods and config in it)."));
  }
  const { root, parent, instance, path } = resolved;

  return {
    label: path,
    async list() {
      const out: string[] = [];
      await walk(root, "", out);
      return out;
    },
    async read(p) {
      const { dir, file } = await dirFor(root, p, false);
      return (await (await dir.getFileHandle(file)).getFile()).text();
    },
    write: (p, content) => writeFile(root, p, content),
    async remove(p) {
      const { dir, file } = await dirFor(root, p, false);
      await dir.removeEntry(file);
    },
    backup: parent
      ? async (instanceFiles = []) => {
          const name = `quests-${timestamp()}`;
          const files: string[] = [];
          await walk(root, "", files);
          const target = await (await parent.getDirectoryHandle("editor-backups", { create: true })).getDirectoryHandle(name, {
            create: true,
          });
          for (const p of files) {
            const { dir, file } = await dirFor(root, p, false);
            await writeFile(target, p, await (await (await dir.getFileHandle(file)).getFile()).text());
          }
          for (const p of instanceFiles) {
            const text = await readInstance(instance, p);
            if (text !== null) await writeFile(target, `instance/${p}`, text);
          }
          return `editor-backups/${name}`;
        }
      : undefined,
    assets: () => instanceAssets(instance),
    readInstanceFile: (p) => readInstance(instance, p),
    async writeInstanceFile(p, content) {
      if (!isEditableInstanceFile(p)) throw new Error(t("This file can't be edited: {path}", { path: p }));
      await writeFile(instance, p, content);
    },
    async writeInstanceBinary(p, content) {
      if (!isEditableInstanceTexture(p)) throw new Error(t("Not writable: {path}", { path: p }));
      await writeFile(instance, p, content);
    },
  };
}

async function readInstance(instance: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  if (!isEditableInstanceFile(path)) return null;
  try {
    const { dir, file } = await dirFor(instance, path, false);
    return await (await (await dir.getFileHandle(file)).getFile()).text();
  } catch {
    return null;
  }
}

/** Mod jars and kubejs/assets of an instance. The vanilla jar lives outside it and is not reachable here. */
async function instanceAssets(instance: FileSystemDirectoryHandle): Promise<AssetBundle | null> {
  const mods = await childDir(instance, "mods");
  if (!mods) return null;
  const archives: AssetArchive[] = [];
  const jars: [string, FileSystemFileHandle][] = [];
  for await (const [name, handle] of mods.entries()) {
    if (handle.kind === "file" && name.endsWith(".jar")) jars.push([name, handle as FileSystemFileHandle]);
  }
  jars.sort(([a], [b]) => a.localeCompare(b));
  for (const [name, handle] of jars) archives.push(zipArchive(blobFile(await handle.getFile(), name)));

  const kubejs = await childDir(instance, "kubejs");
  if (kubejs && (await childDir(kubejs, "assets"))) {
    const files: string[] = [];
    await walk(await kubejs.getDirectoryHandle("assets"), "assets/", files);
    archives.push(
      folderArchive("kubejs", files, async (p) => {
        try {
          const { dir, file } = await dirFor(kubejs, p, false);
          return new Uint8Array(await (await (await dir.getFileHandle(file)).getFile()).arrayBuffer());
        } catch {
          return null;
        }
      }, "kubejs/"),
    );
  }
  return { archives, vanilla: false };
}
