import { archivesFromSpecs, type AssetHost, type InstanceAssetInfo } from "../core/assets/sources";
import { MemoryFileSystem, type QuestFileSystem } from "../core/fs";
import { t } from "../i18n";

/** Dev server only: loads samples/<name> through the Vite middleware. Saves stay in memory. */
export async function sampleFileSystem(name: string): Promise<QuestFileSystem> {
  const base = `/__samples?name=${encodeURIComponent(name)}`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`No quests folder found in samples/${name}`);
  const paths: string[] = await res.json();
  const files: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      files[p] = await (await fetch(`${base}&file=${encodeURIComponent(p)}`)).text();
    }),
  );
  const memory = new MemoryFileSystem(files, `samples/${name} (${t("read-only preview")})`);
  const fs: QuestFileSystem = memory;
  // Lang files are read from the sample; edits stay in memory like everything else here.
  fs.readInstanceFile = async (path) => {
    const edited = memory.instanceFiles.get(path);
    if (edited !== undefined) return edited;
    const r = await fetch(`/__samples/instance?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`);
    return r.ok ? r.text() : null;
  };
  fs.assets = async () => {
    const info: InstanceAssetInfo | null = await (await fetch(`/__samples/assets?name=${encodeURIComponent(name)}`)).json();
    if (!info) return null;
    const host: AssetHost = {
      async readRange(id, offset, length) {
        const r = await fetch(`/__samples/range?id=${encodeURIComponent(id)}&offset=${offset}&length=${length}`);
        return new Uint8Array(await r.arrayBuffer());
      },
      async readFile(id, path) {
        const r = await fetch(`/__samples/file?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`);
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      },
    };
    return { archives: archivesFromSpecs(info.sources, host), version: info.version, vanilla: info.vanilla };
  };
  return fs;
}

// Small 1.20-style pack used by the "Demo" button, so the editor can be tried without a modpack.

const quest = (id: string, x: number, y: number, title: string, item: string, deps: string[] = [], extra = "") => `		{
${deps.length ? `			dependencies: [${deps.map((d) => `"${d}"`).join(", ")}]\n` : ""}			id: "${id}"
${extra}			tasks: [{
				id: "${id.slice(0, 14)}A1"
				item: "${item}"
				type: "item"
			}]
			title: "${title}"
			x: ${x.toFixed(1)}d
			y: ${y.toFixed(1)}d
		}`;

export function demoFileSystem() {
  return new MemoryFileSystem(
    {
      "data.snbt": `{
	default_quest_shape: ""
	id: "0000000000000001"
	title: "Demo Quest Book"
	version: 13
}
`,
      "chapter_groups.snbt": `{
	chapter_groups: [{
		id: "6A6A6A6A6A6A6A6A"
		title: "Technology"
	}]
}
`,
      "chapters/getting_started.snbt": `{
	default_quest_shape: "circle"
	filename: "getting_started"
	group: ""
	icon: "minecraft:oak_sapling"
	id: "1000000000000001"
	order_index: 0
	quest_links: [ ]
	quests: [
${[
  quest("1100000000000001", 0, 0, "Chop Wood", "minecraft:oak_log", [], `			description: [\n				"Everything starts with a log."\n				""\n				"&aColor&r codes work too."\n			]\n			rewards: [{\n				id: "11000000000000B1"\n				type: "xp"\n				xp: 50\n			}]\n			shape: "hexagon"\n			size: 1.5d\n`),
  quest("1100000000000002", 2.5, -1.5, "Crafting Table", "minecraft:crafting_table", ["1100000000000001"]),
  quest("1100000000000003", 2.5, 1.5, "Stone Age", "minecraft:cobblestone", ["1100000000000001"]),
  quest("1100000000000004", 5, 0, "Furnace", "minecraft:furnace", ["1100000000000002", "1100000000000003"]),
  quest("1100000000000005", 7.5, 0, "Iron Age", "minecraft:iron_ingot", ["1100000000000004"], `			shape: "gear"\n`),
].join("\n")}
	]
	title: "Getting Started"
}
`,
      "chapters/redstone.snbt": `{
	default_quest_shape: "square"
	filename: "redstone"
	group: "6A6A6A6A6A6A6A6A"
	icon: "minecraft:redstone"
	id: "2000000000000001"
	order_index: 1
	quests: [
${[
  quest("2200000000000001", 0, 0, "Redstone Dust", "minecraft:redstone", ["1100000000000005"]),
  quest("2200000000000002", 2, 0, "Piston", "minecraft:piston", ["2200000000000001"]),
].join("\n")}
	]
	title: "Redstone"
}
`,
    },
    t("Demo (in memory, never written to disk)"),
  );
}
