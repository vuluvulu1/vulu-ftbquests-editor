import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { QuestBook } from "../src/core/book";
import type { QuestFileSystem } from "../src/core/fs";
import { AssetIndex } from "../src/core/assets/assetIndex";
import { ItemAssets } from "../src/core/assets/items";
import { archivesFromSpecs } from "../src/core/assets/sources";
import { getLong, parseSnbtDocument, writeSnbtDocument } from "../src/core/snbt";
import { findInstanceAssets, nodeAssetHost } from "../src/platform/nodeAssets";

// Tests against real modpacks placed in samples/ (not committed). Each entry may be
// a quests folder or any parent of it (instance folder, config, ftbquests).

const samplesDir = join(__dirname, "..", "samples");

function questRoots(): string[] {
  if (!existsSync(samplesDir)) return [];
  const chains = [[], ["quests"], ["ftbquests", "quests"], ["config", "ftbquests", "quests"]];
  return readdirSync(samplesDir).flatMap((name) => {
    for (const chain of chains) {
      const dir = join(samplesDir, name, ...chain);
      if (existsSync(join(dir, "data.snbt"))) return [dir];
    }
    return [];
  });
}

function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

/** Read-only view of a folder on disk; writes go to memory so samples are never modified. */
function diskFs(root: string): QuestFileSystem & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    label: root,
    written,
    list: async () => listFiles(root),
    read: async (p) => readFileSync(join(root, p), "utf8"),
    write: async (p, c) => void written.set(p, c),
    remove: async (p) => void written.set(p, "<deleted>"),
  };
}

for (const root of questRoots()) {
  const name = relative(samplesDir, root);
  const files = listFiles(root).filter((f) => f.endsWith(".snbt"));

  describe(name, () => {
    it.each(files)("%s round-trips unchanged", (file) => {
      const text = readFileSync(join(root, file), "utf8");
      expect(writeSnbtDocument(parseSnbtDocument(text))).toBe(text);
    });

    it("loads as a quest book without issues", async () => {
      const book = await QuestBook.load(diskFs(root));
      expect(book.issues).toEqual([]);
      expect(book.dirty).toBe(false);
      expect(book.chapters.length).toBeGreaterThan(0);
    });

    it("resolves every table_id to a reward table", async () => {
      const book = await QuestBook.load(diskFs(root));
      const known = new Set(book.rewardTables.map((t) => t.longId));
      const used = book.chapters.flatMap((c) =>
        book.quests(c).flatMap((q) => book.rewards(q).flatMap((r) => (r.entries.has("table_id") ? [getLong(r, "table_id")!] : []))),
      );
      expect(used.filter((id) => !known.has(id))).toEqual([]);
    });

    it("creates table rewards pointing at a real table", async () => {
      const book = await QuestBook.load(diskFs(root));
      const tables = book.rewardTables;
      if (tables.length === 0) return;
      const quest = book.quests(book.chapters[0]!)[0]!;
      const reward = book.addReward(quest, "loot");
      expect(getLong(reward, "table_id")).toBe(tables[0]!.longId);
    });

    it("finds icons for most items used in the book", async () => {
      const found = findInstanceAssets(root);
      if (!found) return; // only the quests folder was copied, no mods
      const assets = new ItemAssets(await AssetIndex.build(archivesFromSpecs(found.sources, nodeAssetHost)));
      const book = await QuestBook.load(diskFs(root));
      const ids = new Set(
        book.chapters.flatMap((c) => book.quests(c).flatMap((q) => book.tasks(q).map((t) => book.itemId(t)).filter(Boolean))),
      );
      let withIcon = 0;
      for (const id of ids) if (await assets.icon(id)) withIcon++;
      // Without the vanilla jar every minecraft: item is missing, so the bar is lower.
      expect(withIcon / ids.size).toBeGreaterThan(found.vanilla ? 0.9 : 0.5);
    }, 120_000);

    it("translates the {key} texts the book uses", async () => {
      const found = findInstanceAssets(root);
      const book = await QuestBook.load(diskFs(root));
      const keys = book.translationKeys();
      if (!found || keys.size === 0) return;
      const assets = new ItemAssets(await AssetIndex.build(archivesFromSpecs(found.sources, nodeAssetHost)));
      const translations = await assets.translations(keys);
      expect(translations.size / keys.size).toBeGreaterThan(0.95);
    }, 120_000);

    it("only rewrites the file that was edited", async () => {
      const fs = diskFs(root);
      const book = await QuestBook.load(fs);
      const chapter = book.chapters.find((c) => book.quests(c).length > 0)!;
      const quest = book.quests(chapter)[0]!;
      book.setText("quest", quest, "subtitle", "edited by test");
      await book.save();
      expect([...fs.written.keys()]).toEqual([book.format.lang ? `lang/${book.locale}.snbt` : chapter.path]);
    });
  });
}
