// Node-only helpers (dev server and tests): discover an instance's asset sources
// (vanilla jar, mods, kubejs, enabled resource packs) and read them with random
// access. Mirrors src-tauri/src/assets.rs.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AssetHost, AssetSourceSpec, InstanceAssetInfo } from "../core/assets/sources";

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Minecraft version from CurseForge, modpack manifest or Prism/MultiMC metadata. */
function detectVersion(instance: string): { version?: string; installPath?: string } {
  const cf = readJson(join(instance, "minecraftinstance.json"));
  if (cf?.gameVersion) return { version: cf.gameVersion, installPath: cf.installPath };
  const manifest = readJson(join(instance, "manifest.json"));
  if (manifest?.minecraft?.version) return { version: manifest.minecraft.version };
  const mmc = readJson(join(dirname(instance), "mmc-pack.json")) ?? readJson(join(instance, "mmc-pack.json"));
  const component = mmc?.components?.find((c: { uid?: string }) => c.uid === "net.minecraft");
  return { version: component?.version };
}

export function vanillaCandidates(instance: string, version: string, installPath?: string): string[] {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const appData = process.env.APPDATA ?? join(home, ".config");
  const bases = [instance, installPath].filter((b): b is string => !!b);
  return [
    ...bases.flatMap((b) => [
      join(b, "..", "..", "Install", "versions", version, `${version}.jar`), // CurseForge
      join(b, "..", "..", "libraries", "com", "mojang", "minecraft", version, `minecraft-${version}-client.jar`), // Prism / MultiMC
      join(b, "..", "..", "..", "libraries", "com", "mojang", "minecraft", version, `minecraft-${version}-client.jar`), // Prism (.minecraft subfolder)
    ]),
    join(home, "curseforge", "minecraft", "Install", "versions", version, `${version}.jar`),
    join(appData, ".minecraft", "versions", version, `${version}.jar`),
    join(appData, "PrismLauncher", "libraries", "com", "mojang", "minecraft", version, `minecraft-${version}-client.jar`),
  ];
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** `resourcePacks:["vanilla","file/foo.zip"]` from options.txt, lowest priority first. */
function enabledResourcePacks(instance: string): string[] {
  try {
    const line = readFileSync(join(instance, "options.txt"), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("resourcePacks:"));
    const packs: string[] = line ? JSON.parse(line.slice("resourcePacks:".length)) : [];
    return packs.filter((p) => p.startsWith("file/")).map((p) => join(instance, "resourcepacks", p.slice(5)));
  } catch {
    return [];
  }
}

function zipSpec(path: string): AssetSourceSpec {
  return { kind: "zip", id: path, name: basename(path), size: statSync(path).size };
}

function dirSpec(root: string, name: string): AssetSourceSpec | undefined {
  const assets = join(root, "assets");
  if (!existsSync(assets)) return undefined;
  const files = listFiles(assets).map((f) => relative(root, f).split(sep).join("/"));
  return { kind: "dir", id: root, name, files };
}

/** `questsRoot` is `<instance>/config/ftbquests/quests`. */
export function findInstanceAssets(questsRoot: string): (InstanceAssetInfo & { instance: string }) | undefined {
  const instance = resolve(questsRoot, "..", "..", "..");
  const modsDir = join(instance, "mods");
  if (!existsSync(modsDir)) return undefined;
  const { version, installPath } = detectVersion(instance);
  const vanilla = version ? vanillaCandidates(instance, version, installPath).find((p) => existsSync(p)) : undefined;

  const sources: AssetSourceSpec[] = [];
  if (vanilla) sources.push(zipSpec(vanilla));
  for (const n of readdirSync(modsDir).sort()) if (n.endsWith(".jar")) sources.push(zipSpec(join(modsDir, n)));
  const kubejs = dirSpec(join(instance, "kubejs"), "kubejs");
  if (kubejs) sources.push(kubejs);
  for (const pack of enabledResourcePacks(instance)) {
    if (!existsSync(pack)) continue;
    const spec = statSync(pack).isDirectory() ? dirSpec(pack, basename(pack)) : zipSpec(pack);
    if (spec) sources.push(spec);
  }
  return { instance, version, vanilla: !!vanilla, sources };
}

/** Reads sources described by {@link findInstanceAssets}; ids are absolute paths. */
export const nodeAssetHost: AssetHost = {
  async readRange(id, offset, length) {
    const handle = await open(id, "r");
    try {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
  async readFile(id, path) {
    const full = resolve(id, path);
    if (!full.startsWith(resolve(id) + sep)) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch {
      return null;
    }
  },
};
