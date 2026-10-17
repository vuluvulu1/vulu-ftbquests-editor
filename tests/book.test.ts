import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QuestBook } from "../src/core/book";
import { MemoryFileSystem } from "../src/core/fs";
import { getNumber, getString, parseSnbt, type SnbtCompound } from "../src/core/snbt";

const chapter = readFileSync(new URL("./fixtures/chapter.snbt", import.meta.url), "utf8");

const DATA = `{
	default_reward_team: false
	id: "0000000000000001"
	version: 13
}
`;

const GROUPS = `{
	chapter_groups: [{
		id: "7A7A7A7A7A7A7A7A"
		title: "Teknoloji"
	}]
}
`;

function legacyFs() {
  return new MemoryFileSystem({
    "data.snbt": DATA,
    "chapter_groups.snbt": GROUPS,
    "chapters/getting_started.snbt": chapter,
  });
}

/** 1.21-style pack: item stacks as compounds, texts in lang/en_us.snbt. */
function langFs() {
  return new MemoryFileSystem({
    "data.snbt": DATA,
    "chapters/start.snbt": `{
	filename: "start"
	id: "1111111111111111"
	order_index: 0
	quests: [{
		id: "2222222222222222"
		tasks: [{
			id: "3333333333333333"
			item: { count: 1, id: "minecraft:dirt" }
			type: "item"
		}]
		x: 0.0d
		y: 0.0d
	}]
}
`,
    "lang/en_us.snbt": `{
	chapter.1111111111111111.title: "Start"
	quest.2222222222222222.quest_desc: [
		"Line 1"
		"Line 2"
	]
	quest.2222222222222222.title: "Dig"
}
`,
  });
}

const questOf = (book: QuestBook, id: string) => book.quest(id)!.quest;

describe("loading", () => {
  it("indexes chapters, quests and groups", async () => {
    const book = await QuestBook.load(legacyFs());
    expect(book.chapters.map((c) => c.id)).toEqual(["3F2A9C1B7D4E8A01"]);
    expect(book.quests(book.chapters[0]!)).toHaveLength(2);
    expect(book.chapterGroups.map((g) => book.getText("chapter_group", g, "title"))).toEqual(["Teknoloji"]);
    expect(book.format).toEqual({ lang: false, itemStyle: "legacy" });
    expect(book.dirty).toBe(false);
  });

  it("detects the 1.21 format", async () => {
    const book = await QuestBook.load(langFs());
    expect(book.format).toEqual({ lang: true, itemStyle: "components" });
  });

  it("reports broken files without failing the whole book", async () => {
    const fs = legacyFs();
    fs.files.set("chapters/broken.snbt", "{ id: ");
    const book = await QuestBook.load(fs);
    expect(book.issues).toHaveLength(1);
    expect(book.issues[0]!.path).toBe("chapters/broken.snbt");
    expect(book.chapters).toHaveLength(1);
  });

  it("refuses folders without data.snbt", async () => {
    await expect(QuestBook.load(new MemoryFileSystem({ "foo.snbt": "{}" }))).rejects.toThrow("data.snbt");
  });
});

describe("texts", () => {
  it("reads and writes inline texts", async () => {
    const book = await QuestBook.load(legacyFs());
    const q = questOf(book, "1A2B3C4D5E6F7081");
    expect(book.getText("quest", q, "title")).toBe("İlk Adım");
    expect(book.getText("quest", q, "description")).toBe('Ağaç kesmekle başla!\n\nBir "balta" işini kolaylaştırır.');
    book.setText("quest", q, "description", "Tek satır");
    book.setText("quest", q, "subtitle", "Alt başlık");
    expect(book.fileText("chapters/getting_started.snbt")).toContain('description: [\n\t\t\t\t"Tek satır"\n\t\t\t]');
    expect(book.fileText("chapters/getting_started.snbt")).toContain('subtitle: "Alt başlık"');
  });

  it("reads and writes lang texts", async () => {
    const book = await QuestBook.load(langFs());
    const q = questOf(book, "2222222222222222");
    expect(book.getText("quest", q, "title")).toBe("Dig");
    expect(book.getText("quest", q, "description")).toBe("Line 1\nLine 2");
    expect(book.getText("chapter", book.chapters[0]!.root, "title")).toBe("Start");

    book.setText("quest", q, "subtitle", "Shovel time");
    book.setText("quest", q, "title", "Kaz", "tr_tr");
    expect(book.fileText("lang/en_us.snbt")).toContain('quest.2222222222222222.quest_subtitle: "Shovel time"');
    expect(book.fileText("lang/tr_tr.snbt")).toBe('{\n\tquest.2222222222222222.title: "Kaz"\n}\n');
    expect(book.getText("quest", q, "title", "tr_tr")).toBe("Kaz");
    // Chapter files must stay free of inline texts in lang mode.
    expect(book.fileText("chapters/start.snbt")).not.toContain("subtitle");
  });
});

describe("editing", () => {
  it("adds quests with unique ids and FTB-typed coordinates", async () => {
    const book = await QuestBook.load(legacyFs());
    const q = book.addQuest(book.chapters[0]!, 4, -2.5);
    const id = getString(q, "id")!;
    expect(id).toMatch(/^[0-9A-F]{16}$/);
    expect(book.quest(id)).toBeDefined();
    expect(book.fileText("chapters/getting_started.snbt")).toContain("x: 4.0d");
  });

  it("deletes a quest and every reference to it", async () => {
    const book = await QuestBook.load(legacyFs());
    book.deleteQuest("1A2B3C4D5E6F7081");
    expect(book.quest("1A2B3C4D5E6F7081")).toBeUndefined();
    expect(book.dependencies(questOf(book, "4D5E6F708192A3B4"))).toEqual([]);
    expect(book.fileText("chapters/getting_started.snbt")).not.toContain("dependencies");
  });

  it("removes lang entries of deleted quests", async () => {
    const book = await QuestBook.load(langFs());
    book.deleteQuest("2222222222222222");
    expect(book.fileText("lang/en_us.snbt")).not.toContain("2222222222222222");
    expect(book.fileText("lang/en_us.snbt")).toContain("chapter.1111111111111111.title");
  });

  it("removes dependencies on a deleted chapter", async () => {
    const book = await QuestBook.load(legacyFs());
    const other = book.addChapter("Diğer");
    const quest = questOf(book, "4D5E6F708192A3B4");
    book.addDependency(quest, other.id);
    book.deleteChapter(book.chapter(other.id)!);
    expect(book.dependencies(quest)).toEqual(["1A2B3C4D5E6F7081"]);
  });

  it("prevents circular dependencies", async () => {
    const book = await QuestBook.load(legacyFs());
    const first = questOf(book, "1A2B3C4D5E6F7081");
    expect(() => book.addDependency(first, "4D5E6F708192A3B4")).toThrow(/circular|döngüsel/);
  });

  it("creates tasks and rewards in the pack's item style", async () => {
    const legacy = await QuestBook.load(legacyFs());
    const task = legacy.addTask(questOf(legacy, "4D5E6F708192A3B4"), "item");
    expect(task.entries.get("item")).toMatchObject({ kind: "string", value: "minecraft:stone" });

    const modern = await QuestBook.load(langFs());
    const reward = modern.addReward(questOf(modern, "2222222222222222"), "item");
    modern.setItemId(reward, "minecraft:diamond");
    expect(modern.itemId(reward)).toBe("minecraft:diamond");
    expect(reward.entries.get("item")).toMatchObject({ kind: "compound" });
  });

  it("resolves custom icon items to their image path", async () => {
    const book = await QuestBook.load(legacyFs());
    const chapter = book.chapters[0]!.root;
    book.replaceContents(
      chapter,
      parseSnbt(`{ id: "3F2A9C1B7D4E8A01", icon: { Count: 1b, id: "ftbquests:custom_icon", tag: { Icon: "kubejs:textures/item/hat.png" } } }`) as SnbtCompound,
    );
    expect(book.iconRef(chapter, "icon")).toBe("texture:kubejs:textures/item/hat.png");
    expect(book.itemId(chapter, "icon")).toBe("ftbquests:custom_icon");
  });

  it("uses the plain item id as icon for normal items", async () => {
    const book = await QuestBook.load(legacyFs());
    const task = book.tasks(questOf(book, "1A2B3C4D5E6F7081"))[0]!;
    expect(book.iconRef(task)).toBe("minecraft:oak_log");
  });

  it("adds chapters with a safe filename and next order index", async () => {
    const book = await QuestBook.load(legacyFs());
    const ch = book.addChapter("Çağ Ötesi Şeyler");
    expect(ch.path).toBe("chapters/cag_otesi_seyler.snbt");
    expect(getNumber(ch.root, "order_index")).toBe(1);
    expect(book.getText("chapter", ch.root, "title")).toBe("Çağ Ötesi Şeyler");
    // Output must be valid SNBT.
    expect(() => parseSnbt(book.fileText(ch.path)!)).not.toThrow();
  });
});

describe("chapter images", () => {
  it("adds, moves (centre and corner based) and deletes images", async () => {
    const book = await QuestBook.load(legacyFs());
    const chapter = book.chapters[0]!;
    const img = book.addImage(chapter, "modpack:textures/opened_letter.png", 2, 3, 6, 4);
    expect(book.images(chapter)).toHaveLength(1);
    expect(book.fileText(chapter.path)).toContain('image: "modpack:textures/opened_letter.png"');

    book.moveImage(chapter, img, 5, 5);
    expect([getNumber(img, "x"), getNumber(img, "y")]).toEqual([5, 5]);

    book.edit("köşe", () => img.entries.set("corner", { kind: "bool", value: true }), chapter.root);
    book.moveImage(chapter, img, 5, 5); // centre (5,5) -> top-left (2,3) for a 6x4 image
    expect([getNumber(img, "x"), getNumber(img, "y")]).toEqual([2, 3]);

    book.deleteImage(chapter, img);
    expect(book.images(chapter)).toHaveLength(0);
    book.undo(); // reloads the chapter file, so look the chapter up again
    expect(book.images(book.chapters[0]!)).toHaveLength(1);
  });
});

describe("translated texts", () => {
  const LANG = "kubejs/assets/modpack/lang/en_us.json";
  const langText = '{\r\n  "q.title": "Balloon",\r\n  "q.desc1": "Line one",\r\n  "q.desc2": "Line two"\r\n}\r\n';

  async function translatedBook() {
    const fs = new MemoryFileSystem(
      {
        "data.snbt": DATA,
        "chapters/c.snbt": `{
	id: "1111111111111111"
	quests: [{
		description: [
			"{q.desc1}"
			""
			"{q.desc2}"
		]
		id: "2222222222222222"
		title: "{q.title}"
		x: 0.0d
		y: 0.0d
	}]
}
`,
      },
      "mem",
      { [LANG]: langText },
    );
    const book = await QuestBook.load(fs);
    const sources = new Map([
      ["q.title", { text: "Balloon", instancePath: LANG }],
      ["q.desc1", { text: "Line one", instancePath: LANG }],
      ["q.desc2", { text: "Line two", instancePath: LANG }],
      ["mod.key", { text: "From a jar" }],
    ]);
    await book.attachTranslations(sources);
    return { fs, book, quest: questOf(book, "2222222222222222") };
  }

  it("edits a title's translation in the lang file, with undo and save", async () => {
    const { fs, book } = await translatedBook();
    expect(book.translation("q.title")).toBe("Balloon");
    expect(book.translationFile("q.title")).toBe(LANG);
    expect(book.dirty).toBe(false);

    book.setTranslation("q.title", "Don't let it burst!");
    expect(book.translations.get("q.title")).toBe("Don't let it burst!");
    expect(book.fileText("chapters/c.snbt")).toContain('title: "{q.title}"'); // the key stays
    book.undo();
    expect(book.translation("q.title")).toBe("Balloon");
    book.redo();

    const result = await book.save();
    expect(result.written).toEqual([`instance:${LANG}`]);
    expect(fs.instanceFiles.get(LANG)).toBe(langText.replace('"Balloon"', '"Don\'t let it burst!"'));
  });

  it("edits description lines as translations and adds keys for new lines", async () => {
    const { fs, book, quest } = await translatedBook();
    expect(book.descriptionEditable("quest", quest)).toBe(true);
    book.setTranslatedDescription("quest", quest, "Line one!\n\nLine two\nBrand new line");
    expect(book.getText("quest", quest, "description")).toBe("{q.desc1}\n\n{q.desc2}\n{q.desc3}");
    expect(book.translation("q.desc1")).toBe("Line one!");
    expect(book.translation("q.desc3")).toBe("Brand new line");
    await book.save();
    expect(JSON.parse(fs.instanceFiles.get(LANG)!)).toMatchObject({ "q.desc1": "Line one!", "q.desc3": "Brand new line" });
  });

  it("keeps translations from mod jars read-only", async () => {
    const { book } = await translatedBook();
    expect(book.translation("mod.key")).toBe("From a jar");
    expect(book.translationFile("mod.key")).toBeUndefined();
    expect(() => book.setTranslation("mod.key", "x")).toThrow();
  });
});

describe("undo / redo", () => {
  it("undoes and redoes edits across files", async () => {
    const book = await QuestBook.load(legacyFs());
    const original = book.fileText("chapters/getting_started.snbt");
    book.moveQuest("1A2B3C4D5E6F7081", 10, 10);
    book.addChapter("Yeni");
    expect(book.chapters).toHaveLength(2);

    book.undo();
    expect(book.chapters).toHaveLength(1);
    book.undo();
    expect(book.fileText("chapters/getting_started.snbt")).toBe(original);
    expect(book.dirty).toBe(false);

    book.redo();
    expect(getNumber(questOf(book, "1A2B3C4D5E6F7081"), "x")).toBe(10);
  });

  it("groups nested edits and rolls back failed ones", async () => {
    const book = await QuestBook.load(legacyFs());
    book.edit("toplu", () => {
      book.moveQuest("1A2B3C4D5E6F7081", 1, 1);
      book.moveQuest("4D5E6F708192A3B4", 2, 2);
    });
    expect(book.undoLabel).toBe("toplu");

    const before = book.fileText("chapters/getting_started.snbt");
    expect(() =>
      book.edit("bozuk", () => {
        book.moveQuest("1A2B3C4D5E6F7081", 99, 99);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(book.fileText("chapters/getting_started.snbt")).toBe(before);
    expect(getNumber(questOf(book, "1A2B3C4D5E6F7081"), "x")).toBe(1);
  });
});

describe("saving", () => {
  it("writes only changed files and removes deleted ones", async () => {
    const fs = legacyFs();
    const book = await QuestBook.load(fs);
    const extra = book.addChapter("Silinecek");
    await book.save();
    expect(fs.files.has(extra.path)).toBe(true);

    book.moveQuest("1A2B3C4D5E6F7081", 3, 3);
    book.deleteChapter(book.chapters.find((c) => c.path === extra.path)!);
    const result = await book.save();
    expect(result.written).toEqual(["chapters/getting_started.snbt"]);
    expect(result.removed).toEqual([extra.path]);
    expect(fs.files.has(extra.path)).toBe(false);
    expect(fs.files.get("data.snbt")).toBe(DATA);
    expect(book.dirty).toBe(false);
  });

  it("still saves changes made outside an edit's declared targets", async () => {
    const fs = legacyFs();
    const book = await QuestBook.load(fs);
    const quest = questOf(book, "1A2B3C4D5E6F7081");
    // Declares data.snbt but actually modifies the chapter file.
    book.edit("yanlış hedef", () => quest.entries.delete("size"), "data.snbt");
    expect(book.dirty).toBe(false);
    const result = await book.save();
    expect(result.written).toEqual(["chapters/getting_started.snbt"]);
    expect(fs.files.get("chapters/getting_started.snbt")).not.toContain("size:");
  });

  it("leaves unparseable files untouched", async () => {
    const fs = legacyFs();
    fs.files.set("chapters/broken.snbt", "{ id: ");
    const book = await QuestBook.load(fs);
    book.moveQuest("1A2B3C4D5E6F7081", 3, 3);
    await book.save();
    expect(fs.files.get("chapters/broken.snbt")).toBe("{ id: ");
  });
});

it("keeps the raw editor's object identity", async () => {
  const book = await QuestBook.load(legacyFs());
  const q = questOf(book, "4D5E6F708192A3B4");
  book.replaceContents(q, parseSnbt('{ id: "4D5E6F708192A3B4", x: 5.0d, y: 1.0d }') as SnbtCompound);
  expect(questOf(book, "4D5E6F708192A3B4")).toBe(q);
  expect(getNumber(q, "x")).toBe(5);
});
