import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { archivesFromSpecs, type AssetHost, type InstanceAssetInfo } from "../core/assets/sources";
import type { QuestFileSystem } from "../core/fs";

// Desktop build: file access goes through the Rust commands in src-tauri/src.

export const isTauri = () => "__TAURI_INTERNALS__" in window;

const assetHost: AssetHost = {
  readRange: async (id, offset, length) => new Uint8Array(await invoke<ArrayBuffer>("read_range", { id, offset, length })),
  readFile: (id, path) =>
    invoke<ArrayBuffer>("read_asset_file", { id, path }).then(
      (b) => new Uint8Array(b),
      () => null,
    ),
};

export async function openTauriFolder(): Promise<QuestFileSystem | undefined> {
  const picked = await open({ directory: true, title: "Mod paketinin (instance) klasörünü seçin" });
  if (typeof picked !== "string") return undefined;
  const root = await invoke<string>("resolve_root", { path: picked });

  return {
    label: root,
    list: () => invoke<string[]>("list_files", { root }),
    read: (path) => invoke<string>("read_file", { root, path }),
    write: (path, content) => invoke("write_file", { root, path, content }),
    remove: (path) => invoke("remove_file", { root, path }),
    backup: (instanceFiles) => invoke<string>("backup", { root, instanceFiles: instanceFiles ?? [] }),
    readInstanceFile: (path) => invoke<string | null>("read_instance_file", { root, path }),
    writeInstanceFile: (path, content) => invoke("write_instance_file", { root, path, content }),
    writeInstanceBinary: (path, content) => invoke("write_instance_binary", { root, path, content: Array.from(content) }),
    async assets() {
      const info = await invoke<InstanceAssetInfo | null>("instance_assets", { root });
      if (!info) return null;
      return { archives: archivesFromSpecs(info.sources, assetHost), version: info.version, vanilla: info.vanilla };
    },
  };
}
