import type { QuestFileSystem } from "./fs";
import { REWARD_TYPES, TASK_TYPES } from "./registry";
import type { TranslationSource } from "./assets/items";
import { setJsonString } from "./jsonText";
import { translationKey } from "./text";
import {
  compound,
  compounds,
  double,
  getBool,
  getList,
  getNumber,
  getString,
  int,
  list,
  parseSnbtDocument,
  setEntry,
  setLong,
  setNumber,
  setString,
  setStrings,
  str,
  strings,
  writeSnbtDocument,
  type SnbtCompound,
  type SnbtDocument,
  type SnbtValue,
} from "./snbt";
import { t } from "../i18n";

/** Object kinds as used in FTB Quests lang keys, e.g. `quest.<id>.title`. */
export type ObjectKind = "file" | "chapter_group" | "chapter" | "quest" | "task" | "reward" | "reward_table";
export type TextField = "title" | "subtitle" | "description";

export interface Chapter {
  path: string;
  root: SnbtCompound;
  id: string;
}

export interface LoadIssue {
  path: string;
  message: string;
}

export interface BookFormat {
  /** Texts live in `lang/<locale>.snbt` (newer FTB Quests for 1.21+) instead of inside the objects. */
  lang: boolean;
  /** 1.21 item stacks are `{ count: 1, id: "..." }`; 1.20 uses a plain id string or `{ Count: 1b, id }`. */
  itemStyle: "legacy" | "components";
}

interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
}

interface ChangeSet {
  label: string;
  changes: FileChange[];
}

interface Index {
  chapters: Chapter[];
  quests: Map<string, { quest: SnbtCompound; chapter: Chapter }>;
  ids: Set<string>;
  /** locale -> lang key -> file path */
  lang: Map<string, Map<string, string>>;
  /** Compound -> path of the file that contains it. */
  owners: WeakMap<SnbtCompound, string>;
}

export interface SaveResult {
  written: string[];
  removed: string[];
  backup?: string;
}

const INLINE_TEXT_KEY: Record<TextField, string> = { title: "title", subtitle: "subtitle", description: "description" };
const LANG_TEXT_KEY: Record<TextField, string> = { title: "title", subtitle: "quest_subtitle", description: "quest_desc" };
const ID_PATTERN = /^[0-9A-F]{16}$/i;
const MAX_UNDO = 200;
/** Prefix of instance files (outside the quests folder) tracked like quest files. */
const INSTANCE = "instance:";

export class QuestBook {
  readonly issues: LoadIssue[] = [];
  format: BookFormat = { lang: false, itemStyle: "legacy" };
  locale = "en_us";
  /** Increments on every change; handy for UI subscriptions. */
  version = 0;

  private docs = new Map<string, SnbtDocument>();
  /** Instance files edited as plain text (KubeJS lang files), keyed `instance:<path>`. */
  private texts = new Map<string, string>();
  private disk = new Map<string, string>();
  private snapshot = new Map<string, string>();
  /** Translations of `{key}` texts that live in a lang file we can edit: key -> `instance:<path>`. */
  private keyFiles = new Map<string, string>();
  /** New binary instance files (PNG images added to chapters), written on save: path -> bytes. */
  private pendingFiles = new Map<string, Uint8Array>();
  /** Translations from mod jars / resource packs: shown, not editable. */
  private fixedTranslations = new Map<string, string>();
  private langJson = new Map<string, { text: string; json: Record<string, unknown> }>();
  private translationsCache?: { version: number; map: Map<string, string> };
  private undoStack: ChangeSet[] = [];
  private redoStack: ChangeSet[] = [];
  private editDepth = 0;
  /** Files the current (outermost) edit may touch: paths or path prefixes ending in "/". */
  private scope: Set<string> | "all" = "all";
  private idx: Index | undefined;
  private listeners = new Set<() => void>();

  private constructor(readonly fs: QuestFileSystem) {}

  static async load(fs: QuestFileSystem): Promise<QuestBook> {
    const book = new QuestBook(fs);
    const paths = (await fs.list()).filter((p) => p.endsWith(".snbt")).sort();
    if (!paths.includes("data.snbt")) {
      throw new Error(t("data.snbt not found. Make sure you chose the right folder."));
    }
    for (const path of paths) {
      const text = await fs.read(path);
      try {
        book.docs.set(path, parseSnbtDocument(text));
        book.disk.set(path, text);
        book.snapshot.set(path, writeSnbtDocument(book.docs.get(path)!));
      } catch (e) {
        book.issues.push({ path, message: e instanceof Error ? e.message : String(e) });
      }
    }
    book.format = book.detectFormat();
    return book;
  }

  // ---- Change tracking -------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Runs `fn` as one undoable step. Nested calls merge into the outermost one.
   * If `fn` throws, every file is restored to its state before the call.
   *
   * `targets` name what `fn` modifies (objects inside a file, or path prefixes like
   * "lang/"), so only those files are re-serialized. Without targets every file is
   * compared, which is always correct but slow on big packs.
   */
  edit<T>(label: string, fn: () => T, ...targets: (SnbtCompound | string)[]): T {
    if (this.editDepth === 0) this.scope = new Set();
    this.addScope(targets);
    this.editDepth++;
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.editDepth--;
      if (this.editDepth === 0) this.restore(this.diff("all").map((c) => ({ ...c, after: c.before })));
      throw e;
    } finally {
      this.idx = undefined;
    }
    this.editDepth--;
    if (this.editDepth === 0) {
      this.commit(label, this.diff(this.scope));
      this.notify();
    }
    return result;
  }

  private commit(label: string, changes: FileChange[]) {
    if (changes.length === 0) return;
    this.undoStack.push({ label, changes });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    for (const c of changes) this.setSnapshot(c.path, c.after);
  }

  private addScope(targets: (SnbtCompound | string)[]) {
    if (this.scope === "all") return;
    if (targets.length === 0) {
      this.scope = "all";
      return;
    }
    for (const t of targets) {
      const path = typeof t === "string" ? t : this.ownerOf(t);
      if (path === undefined) {
        this.scope = "all";
        return;
      }
      this.scope.add(path);
    }
  }

  /** File that contains `obj`, if known. */
  private ownerOf(obj: SnbtCompound): string | undefined {
    const known = this.index.owners.get(obj);
    if (known) return known;
    for (const [path, doc] of this.docs) if (doc.root === obj) return path;
    return undefined;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel() {
    return this.undoStack.at(-1)?.label;
  }
  get redoLabel() {
    return this.redoStack.at(-1)?.label;
  }

  undo() {
    const set = this.undoStack.pop();
    if (!set) return;
    this.restore(set.changes.map((c) => ({ ...c, after: c.before })));
    this.redoStack.push(set);
    this.notify();
  }

  redo() {
    const set = this.redoStack.pop();
    if (!set) return;
    this.restore(set.changes);
    this.undoStack.push(set);
    this.notify();
  }

  /** True when the in-memory state differs from what is on disk. */
  get dirty(): boolean {
    if (this.pendingFiles.size > 0) return true;
    if (this.snapshot.size !== this.disk.size) return true;
    for (const [path, text] of this.snapshot) if (this.disk.get(path) !== text) return true;
    return false;
  }

  /** Paths whose content would change on save (written or removed). */
  pendingChanges(): { written: string[]; removed: string[] } {
    const written = [...this.snapshot].filter(([p, t]) => this.disk.get(p) !== t).map(([p]) => p);
    for (const p of this.pendingFiles.keys()) written.push(INSTANCE + p);
    const removed = [...this.disk.keys()].filter((p) => !this.snapshot.has(p));
    return { written, removed };
  }

  /**
   * Queues a new texture (e.g. an image for a chapter) for `<instance>/<path>`; it is
   * written on the next save, before the quest files that use it.
   */
  addInstanceTexture(path: string, png: Uint8Array) {
    if (!this.fs.writeInstanceBinary) throw new Error(t("Files can't be added to the pack when it's opened this way."));
    this.pendingFiles.set(path, png);
    this.notify();
  }

  hasPendingFile(path: string): boolean {
    return this.pendingFiles.has(path);
  }

  get canAddTextures(): boolean {
    return !!this.fs.writeInstanceBinary;
  }

  async save(): Promise<SaveResult> {
    // Safety net: pick up any change an edit did not declare in its targets.
    const stray = this.diff("all");
    if (stray.length > 0) {
      this.commit("change", stray);
      if (import.meta.env?.DEV) console.warn("Edits outside declared targets:", stray.map((c) => c.path));
    }
    const { written, removed } = this.pendingChanges();
    if (written.length === 0 && removed.length === 0) return { written, removed };
    const instanceFiles = written
      .filter((p) => p.startsWith(INSTANCE) && !this.pendingFiles.has(p.slice(INSTANCE.length)))
      .map((p) => p.slice(INSTANCE.length));
    const backup = this.fs.backup ? await this.fs.backup(instanceFiles) : undefined;
    // New textures first, so quest files never point at an image that is not there yet.
    for (const [path, png] of this.pendingFiles) {
      await this.fs.writeInstanceBinary!(path, png);
      this.pendingFiles.delete(path);
    }
    for (const path of written) {
      if (!this.snapshot.has(path)) continue; // pending texture, written above
      const text = this.snapshot.get(path)!;
      if (path.startsWith(INSTANCE)) await this.fs.writeInstanceFile!(path.slice(INSTANCE.length), text);
      else await this.fs.write(path, text);
      this.disk.set(path, text);
    }
    for (const path of removed) {
      await this.fs.remove(path);
      this.disk.delete(path);
    }
    this.notify();
    return { written, removed, backup };
  }

  /** Serialized text of a file as it would be saved. */
  fileText(path: string): string | undefined {
    return this.snapshot.get(path);
  }

  private diff(scope: Set<string> | "all"): FileChange[] {
    const inScope = (path: string) =>
      scope === "all" || !this.snapshot.has(path) || [...scope].some((s) => (s.endsWith("/") ? path.startsWith(s) : path === s));
    const changes: FileChange[] = [];
    for (const [path, doc] of this.docs) {
      if (!inScope(path)) continue;
      const after = writeSnbtDocument(doc);
      const before = this.snapshot.get(path) ?? null;
      if (before !== after) changes.push({ path, before, after });
    }
    for (const [path, after] of this.texts) {
      if (!inScope(path)) continue;
      const before = this.snapshot.get(path) ?? null;
      if (before !== after) changes.push({ path, before, after });
    }
    for (const [path, before] of this.snapshot) {
      if (!this.docs.has(path) && !this.texts.has(path)) changes.push({ path, before, after: null });
    }
    return changes;
  }

  private restore(changes: FileChange[]) {
    for (const { path, after } of changes) {
      if (path.startsWith(INSTANCE)) {
        if (after === null) this.texts.delete(path);
        else this.texts.set(path, after);
      } else if (after === null) this.docs.delete(path);
      else this.docs.set(path, parseSnbtDocument(after));
      this.setSnapshot(path, after);
    }
    this.idx = undefined;
  }

  // ---- Translations ({key} texts and the lang files that define them) ----------------

  /**
   * Registers where the book's `{key}` texts are translated. Keys defined in an editable
   * instance lang file (KubeJS) become editable; the file joins undo and save.
   */
  async attachTranslations(sources: ReadonlyMap<string, TranslationSource>) {
    const files = new Map<string, string[]>();
    for (const [key, source] of sources) {
      this.fixedTranslations.set(key, source.text);
      if (source.instancePath && this.fs.readInstanceFile && this.fs.writeInstanceFile) {
        files.set(source.instancePath, [...(files.get(source.instancePath) ?? []), key]);
      }
    }
    for (const [rel, keys] of files) {
      const text = await this.fs.readInstanceFile!(rel);
      if (text === null || !this.parseLang(text)) continue; // stays read-only
      const path = INSTANCE + rel;
      this.texts.set(path, text);
      this.disk.set(path, text);
      this.snapshot.set(path, text);
      for (const key of keys) this.keyFiles.set(key, path);
    }
    this.notify();
  }

  private parseLang(text: string): Record<string, unknown> | undefined {
    try {
      const json = JSON.parse(text);
      return json && typeof json === "object" && !Array.isArray(json) ? json : undefined;
    } catch {
      return undefined;
    }
  }

  /** Current translation of `key`, including unsaved edits. */
  translation(key: string): string | undefined {
    const path = this.keyFiles.get(key);
    if (path) {
      const text = this.texts.get(path) ?? "";
      let cached = this.langJson.get(path);
      if (cached?.text !== text) this.langJson.set(path, (cached = { text, json: this.parseLang(text) ?? {} }));
      const value = cached.json[key];
      if (typeof value === "string") return value;
    }
    return this.fixedTranslations.get(key);
  }

  /** All known translations of the book's keys, for display. */
  get translations(): ReadonlyMap<string, string> {
    if (this.translationsCache?.version !== this.version) {
      const map = new Map<string, string>();
      for (const key of new Set([...this.fixedTranslations.keys(), ...this.keyFiles.keys()])) {
        const value = this.translation(key);
        if (value !== undefined) map.set(key, value);
      }
      this.translationsCache = { version: this.version, map };
    }
    return this.translationsCache.map;
  }

  /** Instance-relative lang file that `key` is edited in, if it is editable. */
  translationFile(key: string): string | undefined {
    return this.keyFiles.get(key)?.slice(INSTANCE.length);
  }

  /** Changes what `{key}` shows in game by editing its lang file. */
  setTranslation(key: string, value: string) {
    const path = this.keyFiles.get(key);
    if (!path) throw new Error(t("This text's translation can't be edited: {key}", { key }));
    this.edit("translation", () => this.texts.set(path, setJsonString(this.texts.get(path)!, key, value)), path);
  }

  /** True when every `{key}` line of the description can be edited as translated text. */
  descriptionEditable(kind: ObjectKind, obj: SnbtCompound): boolean {
    const lines = this.getText(kind, obj, "description").split("\n");
    const keys = lines.map(translationKey).filter((k): k is string => !!k);
    return keys.length > 0 && keys.every((k) => this.keyFiles.has(k) && !this.translation(k)?.includes("\n"));
  }

  /**
   * Edits a description whose lines are `{key}`s as the text shown in game: line i of `text`
   * goes into whatever line i of the description is (its translation, or the line itself).
   * Extra lines get new keys following the existing `…descriptionN` numbering.
   */
  setTranslatedDescription(kind: ObjectKind, obj: SnbtCompound, text: string) {
    const raw = this.getText(kind, obj, "description").split("\n");
    const lines = text.split("\n");
    const keys = raw.map(translationKey).filter((k): k is string => !!k);
    const files = [...new Set(keys.map((k) => this.keyFiles.get(k)).filter((p): p is string => !!p))];
    this.edit(
      "description",
      () => {
        const out: string[] = [];
        lines.forEach((line, i) => {
          const key = i < raw.length ? translationKey(raw[i]!) : undefined;
          if (key) {
            if (this.translation(key) !== line) this.setTranslation(key, line);
            out.push(raw[i]!);
          } else if (i < raw.length || line === "") {
            out.push(line);
          } else {
            const newKey = this.nextKey(keys);
            if (!newKey) return out.push(line);
            const path = this.keyFiles.get(keys[0]!)!;
            this.keyFiles.set(newKey, path);
            this.texts.set(path, setJsonString(this.texts.get(path)!, newKey, line));
            keys.push(newKey);
            out.push(`{${newKey}}`);
          }
        });
        if (out.join("\n") !== raw.join("\n")) this.setText(kind, obj, "description", out.join("\n"));
      },
      obj,
      ...files,
    );
  }

  /** `a.description2` -> `a.description3` (skipping keys already taken). */
  private nextKey(keys: string[]): string | undefined {
    let best: { prefix: string; n: number } | undefined;
    for (const key of keys) {
      const m = /^(.*?)(\d+)$/.exec(key);
      if (m && this.keyFiles.has(key) && (!best || Number(m[2]) > best.n)) best = { prefix: m[1]!, n: Number(m[2]) };
    }
    if (!best) return undefined;
    let n = best.n + 1;
    while (this.translation(`${best.prefix}${n}`) !== undefined) n++;
    return `${best.prefix}${n}`;
  }

  private setSnapshot(path: string, text: string | null) {
    if (text === null) this.snapshot.delete(path);
    else this.snapshot.set(path, text);
  }

  private notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- Indexing --------------------------------------------------------------

  private get index(): Index {
    return (this.idx ??= this.buildIndex());
  }

  private buildIndex(): Index {
    const chapters: Chapter[] = [];
    const quests: Index["quests"] = new Map();
    const ids = new Set<string>();
    const lang: Index["lang"] = new Map();

    const owners = new WeakMap<SnbtCompound, string>();

    const visit = (v: SnbtValue, path: string) => {
      if (v.kind === "compound") {
        owners.set(v, path);
        for (const [k, x] of v.entries) {
          if (k === "id" && x.kind === "string" && ID_PATTERN.test(x.value)) ids.add(x.value.toUpperCase());
          else visit(x, path);
        }
      } else if (v.kind === "list") for (const x of v.items) visit(x, path);
    };

    for (const [path, doc] of this.docs) {
      visit(doc.root, path);
      if (doc.root.kind !== "compound") continue;
      if (path.startsWith("chapters/")) {
        const chapter: Chapter = { path, root: doc.root, id: getString(doc.root, "id") ?? "" };
        chapters.push(chapter);
        for (const quest of compounds(getList(doc.root, "quests"))) {
          const id = getString(quest, "id");
          if (id) quests.set(id, { quest, chapter });
        }
      } else if (path.startsWith("lang/")) {
        const locale = path.slice(5).split(/[/.]/)[0]!;
        let keys = lang.get(locale);
        if (!keys) lang.set(locale, (keys = new Map()));
        for (const key of doc.root.entries.keys()) if (!keys.has(key)) keys.set(key, path);
      }
    }

    chapters.sort(
      (a, b) =>
        (getNumber(a.root, "order_index") ?? 0) - (getNumber(b.root, "order_index") ?? 0) || a.path.localeCompare(b.path),
    );
    return { chapters, quests, ids, lang, owners };
  }

  private detectFormat(): BookFormat {
    const lang = [...this.docs.keys()].some((p) => p.startsWith("lang/"));
    let itemStyle: BookFormat["itemStyle"] | undefined;
    const visit = (v: SnbtValue) => {
      if (itemStyle) return;
      if (v.kind === "compound") {
        const item = v.entries.get("item");
        if (item?.kind === "compound") {
          if (item.entries.has("count") || item.entries.has("components")) itemStyle = "components";
          else if (item.entries.has("Count") || item.entries.has("tag")) itemStyle = "legacy";
        } else if (item?.kind === "string") itemStyle = "legacy";
        v.entries.forEach(visit);
      } else if (v.kind === "list") v.items.forEach(visit);
    };
    for (const doc of this.docs.values()) visit(doc.root);
    return { lang, itemStyle: itemStyle ?? (lang ? "components" : "legacy") };
  }

  // ---- Queries ---------------------------------------------------------------

  get data(): SnbtCompound | undefined {
    const root = this.docs.get("data.snbt")?.root;
    return root?.kind === "compound" ? root : undefined;
  }

  get chapters(): Chapter[] {
    return this.index.chapters;
  }

  chapter(id: string): Chapter | undefined {
    return this.index.chapters.find((c) => c.id === id);
  }

  get chapterGroups(): SnbtCompound[] {
    const root = this.docs.get("chapter_groups.snbt")?.root;
    return root?.kind === "compound" ? compounds(getList(root, "chapter_groups")) : [];
  }

  /** Reward tables from `reward_tables/*.snbt`, sorted like FTB does (order_index). */
  get rewardTables(): { path: string; root: SnbtCompound; id: string; longId: bigint }[] {
    return [...this.docs]
      .filter(([path, doc]) => path.startsWith("reward_tables/") && doc.root.kind === "compound")
      .map(([path, doc]) => {
        const root = doc.root as SnbtCompound;
        const id = getString(root, "id") ?? "";
        return { path, root, id, longId: QuestBook.longId(id) };
      })
      .sort((a, b) => (getNumber(a.root, "order_index") ?? 0) - (getNumber(b.root, "order_index") ?? 0) || a.path.localeCompare(b.path));
  }

  /** Every `{translation.key}` used by any text in the book. */
  translationKeys(): Set<string> {
    const keys = new Set<string>();
    const visit = (v: SnbtValue) => {
      if (v.kind === "string") {
        const key = translationKey(v.value);
        if (key) keys.add(key);
      } else if (v.kind === "compound") v.entries.forEach(visit);
      else if (v.kind === "list") v.items.forEach(visit);
    };
    for (const doc of this.docs.values()) visit(doc.root);
    return keys;
  }

  /** Rewards refer to tables by the signed 64-bit value of their hex id (`table_id: <long>L`). */
  static longId(hexId: string): bigint {
    return ID_PATTERN.test(hexId) ? BigInt.asIntN(64, BigInt(`0x${hexId}`)) : 0n;
  }

  quests(chapter: Chapter): SnbtCompound[] {
    return compounds(getList(chapter.root, "quests"));
  }

  questLinks(chapter: Chapter): SnbtCompound[] {
    return compounds(getList(chapter.root, "quest_links"));
  }

  quest(id: string) {
    return this.index.quests.get(id);
  }

  setLocale(locale: string) {
    this.locale = locale;
    this.notify();
  }

  get locales(): string[] {
    const found = [...this.index.lang.keys()];
    return found.includes(this.locale) ? found.sort() : [...found, this.locale].sort();
  }

  newId(): string {
    const ids = this.index.ids;
    const bytes = new Uint8Array(8);
    while (true) {
      crypto.getRandomValues(bytes);
      const id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      if (id !== "0000000000000000" && id !== "0000000000000001" && !ids.has(id)) {
        ids.add(id);
        return id;
      }
    }
  }

  // ---- Texts -----------------------------------------------------------------

  /** Title / subtitle / description, read from lang files or the object itself. Descriptions use "\n" between lines. */
  getText(kind: ObjectKind, obj: SnbtCompound, field: TextField, locale = this.locale): string {
    if (this.format.lang) {
      const value = this.langValue(`${kind}.${getString(obj, "id")}.${LANG_TEXT_KEY[field]}`, locale);
      if (value !== undefined) return value;
    }
    const inline = obj.entries.get(INLINE_TEXT_KEY[field]);
    return field === "description" ? strings(inline).join("\n") : inline?.kind === "string" ? inline.value : "";
  }

  setText(kind: ObjectKind, obj: SnbtCompound, field: TextField, value: string, locale = this.locale) {
    this.edit(`change ${field}`, () => {
      const lines = value.split("\n");
      if (!this.format.lang) {
        const key = INLINE_TEXT_KEY[field];
        if (field === "description") setStrings(obj, key, value === "" ? [] : lines);
        else if (value === "") obj.entries.delete(key);
        else setString(obj, key, value);
        return;
      }
      obj.entries.delete(INLINE_TEXT_KEY[field]);
      const key = `${kind}.${getString(obj, "id")}.${LANG_TEXT_KEY[field]}`;
      const langValue: SnbtValue | null =
        value === "" ? null : field === "description" ? list(lines.map(str)) : str(value);
      this.setLangValue(key, langValue, locale);
    }, obj, "lang/");
  }

  private langValue(key: string, locale: string): string | undefined {
    const path = this.index.lang.get(locale)?.get(key);
    const root = path ? this.docs.get(path)?.root : undefined;
    if (root?.kind !== "compound") return undefined;
    const v = root.entries.get(key);
    if (v?.kind === "string") return v.value;
    if (v?.kind === "list") return strings(v).join("\n");
    return undefined;
  }

  private setLangValue(key: string, value: SnbtValue | null, locale: string) {
    const files = this.index.lang.get(locale);
    let path = files?.get(key);
    if (!path && value === null) return;
    if (!path) {
      const main = `lang/${locale}.snbt`;
      path = this.docs.has(main) || !files ? main : [...new Set(files.values())].sort()[0]!;
      if (!this.docs.has(path)) {
        this.docs.set(path, { root: compound(), eol: "\n", indent: "\t", trailingNewline: true });
      }
    }
    const root = this.docs.get(path)!.root as SnbtCompound;
    if (value === null) root.entries.delete(key);
    else setEntry(root, key, value);
    this.idx = undefined;
  }

  private removeLangKeys(prefixes: string[]) {
    for (const [path, doc] of this.docs) {
      if (!path.startsWith("lang/") || doc.root.kind !== "compound") continue;
      for (const key of [...doc.root.entries.keys()]) {
        if (prefixes.some((p) => key.startsWith(p))) doc.root.entries.delete(key);
      }
    }
  }

  // ---- Items -----------------------------------------------------------------

  /** Item id of `obj[key]`, which is either a plain id string or an item stack compound. */
  itemId(obj: SnbtCompound, key = "item"): string {
    const item = obj.entries.get(key);
    if (item?.kind === "string") return item.value;
    if (item?.kind === "compound") return getString(item, "id") ?? "";
    return "";
  }

  /**
   * What to draw for `obj[key]`: the item id, or `texture:<path>` for FTB's
   * `ftbquests:custom_icon`, which carries an image path in its `Icon` tag.
   */
  iconRef(obj: SnbtCompound, key = "item"): string {
    const item = obj.entries.get(key);
    if (item?.kind === "compound" && getString(item, "id") === "ftbquests:custom_icon") {
      const tag = item.entries.get("tag") ?? item.entries.get("components");
      const icon = tag?.kind === "compound" ? (getString(tag, "Icon") ?? getString(tag, "ftbquests:icon")) : undefined;
      if (icon) return `texture:${icon}`;
    }
    return this.itemId(obj, key);
  }

  setItemId(obj: SnbtCompound, id: string, key = "item") {
    this.edit("change item", () => {
      const item = obj.entries.get(key);
      if (id === "" && key !== "item") obj.entries.delete(key);
      else if (item?.kind === "string") item.value = id;
      else if (item?.kind === "compound") setString(item, "id", id);
      else setEntry(obj, key, this.newItem(id));
    }, obj);
  }

  private newItem(id: string): SnbtValue {
    return this.format.itemStyle === "components" ? compound({ count: int(1), id: str(id) }) : str(id);
  }

  // ---- Chapters --------------------------------------------------------------

  addChapter(title: string, group = ""): Chapter {
    return this.edit("add chapter", () => {
      const filename = this.uniqueFilename(title);
      const order = Math.max(-1, ...this.chapters.map((c) => getNumber(c.root, "order_index") ?? 0)) + 1;
      const root = compound({
        default_hide_dependency_lines: { kind: "bool", value: false },
        default_quest_shape: str(""),
        filename: str(filename),
        group: str(group),
        id: str(this.newId()),
        order_index: int(order),
        quest_links: list(),
        quests: list(),
      });
      const path = `chapters/${filename}.snbt`;
      this.docs.set(path, { root, eol: this.preferredEol(), indent: "\t", trailingNewline: true });
      this.idx = undefined;
      const chapter = this.chapters.find((c) => c.path === path)!;
      if (title) this.setText("chapter", root, "title", title);
      return chapter;
    }, "lang/");
  }

  deleteChapter(chapter: Chapter) {
    this.edit("delete chapter", () => {
      for (const quest of this.quests(chapter)) this.deleteQuest(getString(quest, "id")!);
      // Quests may depend on a whole chapter.
      for (const other of this.chapters) for (const quest of this.quests(other)) this.removeDependency(quest, chapter.id);
      this.docs.delete(chapter.path);
      this.removeLangKeys([`chapter.${chapter.id}.`]);
      this.idx = undefined;
    });
  }

  /** The group a chapter is listed under: its `group` if that group exists, otherwise "" (ungrouped). */
  chapterGroupId(chapter: Chapter): string {
    const group = getString(chapter.root, "group") ?? "";
    return this.chapterGroups.some((g) => getString(g, "id") === group) ? group : "";
  }

  /** Chapters of one group in display order. */
  groupChapters(groupId: string): Chapter[] {
    return this.chapters.filter((c) => this.chapterGroupId(c) === groupId);
  }

  /**
   * Moves a chapter `delta` places up (-1) or down (+1) within its group. FTB orders chapters
   * by `order_index` inside each group, so only that group is renumbered (and only changed files).
   */
  moveChapter(chapter: Chapter, delta: number) {
    const siblings = this.groupChapters(this.chapterGroupId(chapter));
    const from = siblings.findIndex((c) => c.path === chapter.path);
    const to = Math.max(0, Math.min(from + delta, siblings.length - 1));
    if (from < 0 || to === from) return;
    siblings.splice(to, 0, ...siblings.splice(from, 1));
    this.edit("chapter order", () => {
      siblings.forEach((c, i) => {
        if (getNumber(c.root, "order_index") !== i) setNumber(c.root, "order_index", i, "int");
      });
    }, "chapters/");
  }

  private uniqueFilename(title: string): string {
    const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
    const base =
      title
        .toLocaleLowerCase("tr")
        .replace(/[çğıöşü]/g, (c) => map[c]!)
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "chapter";
    let name = base;
    for (let i = 2; this.docs.has(`chapters/${name}.snbt`); i++) name = `${base}_${i}`;
    return name;
  }

  private preferredEol(): "\n" | "\r\n" {
    return this.docs.get("data.snbt")?.eol ?? "\n";
  }

  // ---- Quests ----------------------------------------------------------------

  addQuest(chapter: Chapter, x: number, y: number): SnbtCompound {
    return this.edit("add quest", () => {
      const quest = compound({ id: str(this.newId()), x: double(x), y: double(y) });
      let quests = getList(chapter.root, "quests");
      if (!quests) setEntry(chapter.root, "quests", (quests = list()));
      quests.items.push(quest);
      this.idx = undefined;
      return quest;
    }, chapter.root);
  }

  moveQuest(id: string, x: number, y: number) {
    const found = this.quest(id);
    if (!found) return;
    this.edit("move quest", () => {
      setNumber(found.quest, "x", x, "double");
      setNumber(found.quest, "y", y, "double");
    }, found.quest);
  }

  moveQuestLink(chapter: Chapter, linkId: string, x: number, y: number) {
    const link = this.questLinks(chapter).find((l) => getString(l, "id") === linkId);
    if (!link) return;
    this.edit("move link", () => {
      setNumber(link, "x", x, "double");
      setNumber(link, "y", y, "double");
    }, link);
  }

  // ---- Chapter images ---------------------------------------------------------
  // FTB's decorations on the quest map: { image, x, y, width, height, rotation, corner,
  // dependency, order, alpha, hover, click, dev }. They have no id; the list index is used.

  images(chapter: Chapter): SnbtCompound[] {
    return compounds(getList(chapter.root, "images"));
  }

  /** Adds an image centred at (x, y), sized in quest-grid units. */
  addImage(chapter: Chapter, image: string, x: number, y: number, width = 1, height = 1): SnbtCompound {
    return this.edit(
      "add image",
      () => {
        const img = compound({
          height: double(height),
          image: str(image),
          rotation: double(0),
          width: double(width),
          x: double(x),
          y: double(y),
        });
        let images = getList(chapter.root, "images");
        if (!images) setEntry(chapter.root, "images", (images = list()));
        images.items.push(img);
        return img;
      },
      chapter.root,
    );
  }

  /** Moves an image so its centre is at (x, y); `corner` images store their top-left corner. */
  moveImage(chapter: Chapter, img: SnbtCompound, centerX: number, centerY: number) {
    const corner = getBool(img, "corner") ?? false;
    const x = corner ? centerX - (getNumber(img, "width") ?? 1) / 2 : centerX;
    const y = corner ? centerY - (getNumber(img, "height") ?? 1) / 2 : centerY;
    this.edit(
      "move image",
      () => {
        setNumber(img, "x", x, "double");
        setNumber(img, "y", y, "double");
      },
      chapter.root,
    );
  }

  deleteImage(chapter: Chapter, img: SnbtCompound) {
    this.edit(
      "delete image",
      () => {
        const images = getList(chapter.root, "images");
        if (!images) return;
        images.items = images.items.filter((i) => i !== img);
      },
      chapter.root,
    );
  }

  /** Deletes a quest and every reference to it (dependencies, quest links, lang entries). */
  deleteQuest(id: string) {
    const found = this.quest(id);
    if (!found) return;
    this.edit("delete quest", () => {
      const quests = getList(found.chapter.root, "quests")!;
      quests.items = quests.items.filter((q) => q !== found.quest);

      const prefixes = [`quest.${id}.`];
      for (const key of ["tasks", "rewards"] as const) {
        for (const sub of compounds(getList(found.quest, key))) {
          prefixes.push(`${key === "tasks" ? "task" : "reward"}.${getString(sub, "id")}.`);
        }
      }
      this.removeLangKeys(prefixes);

      for (const chapter of this.chapters) {
        for (const quest of this.quests(chapter)) this.removeDependency(quest, id);
        const links = getList(chapter.root, "quest_links");
        if (links) links.items = links.items.filter((l) => l.kind !== "compound" || getString(l, "linked_quest") !== id);
      }
      this.idx = undefined;
    });
  }

  dependencies(quest: SnbtCompound): string[] {
    return strings(quest.entries.get("dependencies"));
  }

  addDependency(quest: SnbtCompound, dependsOn: string) {
    if (getString(quest, "id") === dependsOn || this.dependencies(quest).includes(dependsOn)) return;
    if (this.dependsTransitively(dependsOn, getString(quest, "id")!)) {
      throw new Error(t("This would create a circular dependency."));
    }
    this.edit("add dependency", () => {
      setStrings(quest, "dependencies", [...this.dependencies(quest), dependsOn], { inline: true });
    }, quest);
  }

  removeDependency(quest: SnbtCompound, dependsOn: string) {
    const deps = this.dependencies(quest);
    if (!deps.includes(dependsOn)) return;
    this.edit("remove dependency", () => {
      setStrings(
        quest,
        "dependencies",
        deps.filter((d) => d !== dependsOn),
      );
    }, quest);
  }

  /** True if quest `from` depends (directly or indirectly) on quest `target`. */
  private dependsTransitively(from: string, target: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const quest = this.quest(id)?.quest;
      if (quest) stack.push(...this.dependencies(quest));
    }
    return false;
  }

  // ---- Tasks & rewards -------------------------------------------------------

  tasks(quest: SnbtCompound): SnbtCompound[] {
    return compounds(getList(quest, "tasks"));
  }

  rewards(quest: SnbtCompound): SnbtCompound[] {
    return compounds(getList(quest, "rewards"));
  }

  addTask(quest: SnbtCompound, type: string): SnbtCompound {
    return this.addSub(quest, "tasks", type);
  }

  addReward(quest: SnbtCompound, type: string): SnbtCompound {
    return this.addSub(quest, "rewards", type);
  }

  removeTask(quest: SnbtCompound, task: SnbtCompound) {
    this.removeSub(quest, "tasks", task);
  }

  removeReward(quest: SnbtCompound, reward: SnbtCompound) {
    this.removeSub(quest, "rewards", reward);
  }

  private addSub(quest: SnbtCompound, key: "tasks" | "rewards", type: string): SnbtCompound {
    const spec = (key === "tasks" ? TASK_TYPES : REWARD_TYPES).find((t) => t.type === type);
    return this.edit(key === "tasks" ? "add task" : "add reward", () => {
      const obj = spec?.create() ?? compound();
      setEntry(obj, "id", str(this.newId()));
      setEntry(obj, "type", str(type));
      if (spec?.hasItem) setEntry(obj, "item", this.newItem("minecraft:stone"));
      const firstTable = this.rewardTables[0];
      if (firstTable && spec?.fields.some((f) => f.kind === "table")) setLong(obj, "table_id", firstTable.longId);
      let items = getList(quest, key);
      if (!items) setEntry(quest, key, (items = list()));
      items.items.push(obj);
      return obj;
    }, quest);
  }

  private removeSub(quest: SnbtCompound, key: "tasks" | "rewards", obj: SnbtCompound) {
    this.edit(key === "tasks" ? "delete task" : "delete reward", () => {
      const items = getList(quest, key);
      if (!items) return;
      items.items = items.items.filter((x) => x !== obj);
      if (items.items.length === 0) quest.entries.delete(key);
      this.removeLangKeys([`${key === "tasks" ? "task" : "reward"}.${getString(obj, "id")}.`]);
    }, quest, "lang/");
  }

  /**
   * Replaces the contents of `target` with `replacement` (used by the raw SNBT editor).
   * The object keeps its identity so references held by the UI stay valid.
   */
  replaceContents(target: SnbtCompound, replacement: SnbtCompound) {
    this.edit("edit SNBT", () => {
      target.entries = new Map(replacement.entries);
      target.inline = replacement.inline;
    }, target);
  }
}
