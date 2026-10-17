import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { isEditableInstanceFile } from "./src/core/fs";
import { findInstanceAssets, nodeAssetHost } from "./src/platform/nodeAssets";

/**
 * Dev-only: serves quest folders (and the instance's mod assets) from samples/ so
 * `?sample=<name>` can load a real pack in the browser without the folder picker. Read-only.
 */
function samplesPlugin(): Plugin {
  const samples = resolve(__dirname, "samples");
  const chains = [[], ["quests"], ["ftbquests", "quests"], ["config", "ftbquests", "quests"]];
  const questRoot = (name: string) =>
    chains.map((c) => join(samples, name, ...c)).find((d) => d.startsWith(samples + sep) && existsSync(join(d, "data.snbt")));
  const list = (dir: string, prefix = ""): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? list(join(dir, n), `${prefix}${n}/`) : [`${prefix}${n}`]));
  /** Asset source ids handed out by /assets; only these may be read. */
  const allowed = new Set<string>();

  return {
    name: "samples",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__samples", (req, res) => {
        // An error here must not take the whole dev server (and tauri dev) down.
        handle(req.url ?? "/", res).catch((e) => {
          console.error("[samples]", e);
          if (!res.headersSent) res.writeHead(500);
          res.end(String(e));
        });
      });

      async function handle(reqUrl: string, res: import("node:http").ServerResponse) {
        const url = new URL(reqUrl, "http://x");
        const q = (k: string) => url.searchParams.get(k) ?? "";
        const json = (v: unknown) => void res.setHeader("content-type", "application/json").end(JSON.stringify(v));
        const notFound = () => void res.writeHead(404).end();

        if (url.pathname === "/assets") {
          const root = questRoot(q("name"));
          const info = root ? findInstanceAssets(root) : undefined;
          if (!info) return json(null);
          for (const s of info.sources) allowed.add(s.id);
          return json({ version: info.version, vanilla: info.vanilla, sources: info.sources });
        }
        if (url.pathname === "/instance") {
          const root = questRoot(q("name"));
          const path = q("path");
          if (!root || !isEditableInstanceFile(path)) return notFound();
          const file = resolve(root, "..", "..", "..", path);
          return existsSync(file) ? void res.setHeader("content-type", "text/plain; charset=utf-8").end(readFileSync(file, "utf8")) : notFound();
        }
        if (url.pathname === "/range") {
          if (!allowed.has(q("id"))) return notFound();
          const bytes = await nodeAssetHost.readRange(q("id"), Number(q("offset")), Number(q("length")));
          return void res.setHeader("content-type", "application/octet-stream").end(bytes);
        }
        if (url.pathname === "/file") {
          if (!allowed.has(q("id"))) return notFound();
          const bytes = await nodeAssetHost.readFile(q("id"), q("path"));
          return bytes ? void res.setHeader("content-type", "application/octet-stream").end(bytes) : notFound();
        }

        const root = questRoot(q("name"));
        const file = url.searchParams.get("file");
        if (!root) return void res.writeHead(404).end("sample not found");
        if (file === null) return json(list(root));
        const path = resolve(root, file);
        if (!path.startsWith(root + sep) || !existsSync(path)) return notFound();
        res.setHeader("content-type", "text/plain; charset=utf-8").end(readFileSync(path, "utf8"));
      }
    },
  };
}

// Port is fixed so `tauri dev` can find the dev server.
export default defineConfig({
  plugins: [react(), samplesPlugin()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/samples/**", "**/src-tauri/**"] } },
  build: { target: "es2022" },
  test: { include: ["tests/**/*.test.ts"] },
});
