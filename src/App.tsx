import { useCallback, useEffect, useRef, useState } from "react";
import { t, useLang } from "./i18n";
import { AssetIndex } from "./core/assets/assetIndex";
import { ItemAssets } from "./core/assets/items";
import { QuestBook } from "./core/book";
import type { QuestFileSystem } from "./core/fs";
import { browserFsSupported, openBrowserFolder } from "./platform/browserFs";
import { demoFileSystem, sampleFileSystem } from "./platform/demo";
import { isTauri, openTauriFolder } from "./platform/tauriFs";
import { questIconId, useBookVersion } from "./ui/hooks";
import { AssetsContext, preloadIcons, shapeTextureRefs, ThemeBackdrop } from "./ui/ItemIcon";
import { initialSteps, LoadingOverlay, type LoadStep } from "./ui/LoadingOverlay";
import { TranslationsContext } from "./ui/McText";
import { ContextMenuHost } from "./ui/simple/ContextMenu";
import { savedMode, saveMode, type EditorMode } from "./ui/simple/mode";
import { ModeChooser } from "./ui/simple/ModeChooser";
import { Workspace } from "./ui/Workspace";
import { LanguageSelect } from "./ui/LanguageSelect";

interface Toast {
  kind: "info" | "error";
  text: string;
}

export function App() {
  const [book, setBook] = useState<QuestBook | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [questId, setQuestId] = useState<string | null>(null);
  /** Index in the current chapter's "images" list. */
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  /** null until chosen: the chooser is shown on first launch. */
  const [mode, setMode] = useState<EditorMode | null>(() => savedMode());
  const [choosingMode, setChoosingMode] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<ItemAssets | null>(null);
  const [assetStatus, setAssetStatus] = useState<{ text: string; title?: string } | null>(null);
  const [steps, setSteps] = useState<LoadStep[] | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [loadSource, setLoadSource] = useState("");
  const loadToken = useRef(0);
  const version = useBookVersion(book);
  // A language switch remounts the workspace so every label is redrawn (selection lives here).
  const lang = useLang();

  const notify = useCallback((kind: Toast["kind"], text: string) => setToast({ kind, text }), []);
  const onError = useCallback((text: string) => notify("error", text), [notify]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * Opens a pack: reads the quest book, then indexes mod assets, loads translations and
   * draws icons, showing each step on the loading screen. A newer load cancels an older one.
   */
  const load = async (getFs: () => Promise<QuestFileSystem | undefined>) => {
    if (book?.dirty && !window.confirm(t("Unsaved changes will be lost. Continue?"))) return;
    let fs: QuestFileSystem | undefined;
    try {
      fs = await getFs();
    } catch (e) {
      return notify("error", e instanceof Error ? e.message : String(e));
    }
    if (!fs) return;

    const token = ++loadToken.current;
    const current = () => token === loadToken.current;
    const step = (id: LoadStep["id"], patch: Partial<LoadStep>) =>
      current() && setSteps((s) => s?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? null);

    setSteps(initialSteps(!!fs.assets));
    setLoadSource(fs.label);
    setOverlay(true);
    setAssets(null);
    setAssetStatus(null);
    setBusy(true);
    try {
      const loaded = await QuestBook.load(fs);
      if (!current()) return;
      setBook(loaded);
      setChapterId(loaded.chapters[0]?.id ?? null);
      setQuestId(null);
      const questCount = loaded.chapters.reduce((n, c) => n + loaded.quests(c).length, 0);
      step("book", { state: "done", detail: t("{chapters} chapters, {quests} quests", { chapters: loaded.chapters.length, quests: questCount }) });
      if (loaded.issues.length > 0) notify("error", t("{count} files could not be read; they will be left untouched.", { count: loaded.issues.length }));
      setBusy(false);
      if (fs.assets) await loadAssets(fs, loaded, step, current);
    } catch (e) {
      if (current()) notify("error", e instanceof Error ? e.message : String(e));
    } finally {
      if (current()) {
        setBusy(false);
        setOverlay(false);
        setSteps(null);
      }
    }
  };

  const loadAssets = async (
    fs: QuestFileSystem,
    loaded: QuestBook,
    step: (id: LoadStep["id"], patch: Partial<LoadStep>) => void,
    current: () => boolean,
  ) => {
    step("index", { state: "active" });
    const bundle = await fs.assets!();
    if (!current()) return;
    if (!bundle) {
      for (const id of ["index", "texts", "icons"] as const) step(id, { state: "skipped" });
      setAssetStatus({ text: t("No icons"), title: t("Couldn't reach the instance's mods folder.") });
      return;
    }
    const index = await AssetIndex.build(bundle.archives, (p) => step("index", { detail: `${p.done}/${p.total}` }));
    if (!current()) return;
    const assets = new ItemAssets(index);
    setAssets(assets);
    step("index", { state: "done", detail: t("{count} sources", { count: index.archives }) });

    step("texts", { state: "active" });
    const keys = loaded.translationKeys();
    const translations = await assets.translations(keys, (d, t) => step("texts", { detail: `${d}/${t}` }));
    if (!current()) return;
    await loaded.attachTranslations(translations);
    step("texts", { state: "done", detail: keys.size ? t("{found}/{total} texts", { found: translations.size, total: keys.size }) : t("not needed") });

    step("icons", { state: "active" });
    const ids = loaded.chapters.flatMap((c) => [
      loaded.iconRef(c.root, "icon"),
      ...loaded.quests(c).map((q) => questIconId(loaded, q) ?? ""),
    ]);
    const ui = [...shapeTextureRefs(assets), "texture:ftblibrary:textures/gui/background_squares.png"];
    await preloadIcons(assets, [...ui, ...ids.filter(Boolean)], (d, t) => step("icons", { detail: `${d}/${t}` }));
    if (!current()) return;
    step("icons", { state: "done" });

    const warnings = [
      !bundle.vanilla && t("Vanilla Minecraft jar not found: minecraft: items will have no icons."),
      index.issues.length > 0 && t("{count} files could not be read: {files}", { count: index.issues.length, files: index.issues.map((i) => i.file).join(", ") }),
      keys.size > translations.size && t("{count} translation keys were not found in the lang files.", { count: keys.size - translations.size }),
    ].filter(Boolean);
    setAssetStatus({
      text: `${warnings.length ? "⚠ " : ""}${t("{count} sources", { count: index.archives })}`,
      title: [t("Minecraft {version}, {count} files", { version: bundle.version ?? "?", count: index.size }), ...warnings].join("\n"),
    });
  };

  const openFolder = () => load(isTauri() ? openTauriFolder : openBrowserFolder);

  // Dev only: `?sample=<name>` opens samples/<name> (see vite.config.ts).
  useEffect(() => {
    const sample = new URLSearchParams(location.search).get("sample");
    if (import.meta.env.DEV && sample) void load(() => sampleFileSystem(sample));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    if (!book || !book.dirty) return;
    try {
      setBusy(true);
      const result = await book.save();
      const count = result.written.length + result.removed.length;
      notify("info", t("{count} files saved.", { count }) + (result.backup ? ` ${t("Backup: {path}", { path: result.backup })}` : ""));
    } catch (e) {
      notify("error", t("Save failed: {error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }, [book, notify]);

  // Keyboard shortcuts (skipped while typing so text inputs keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!book || !(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void save();
        return;
      }
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if (typing) return;
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        book.undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        book.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [book, save]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (book?.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [book]);

  const chapter = book && chapterId ? book.chapter(chapterId) : undefined;
  // Keep selections valid after undo / delete.
  useEffect(() => {
    if (!book) return;
    if (chapterId && !book.chapter(chapterId)) setChapterId(book.chapters[0]?.id ?? null);
    if (questId && !book.quest(questId)) setQuestId(null);
  }, [book, version, chapterId, questId]);

  const select = useCallback((id: string | null, inChapter?: string) => {
    if (inChapter) setChapterId(inChapter);
    setQuestId(id);
    setImageIndex(null);
  }, []);

  const canOpen = isTauri() || browserFsSupported();
  const activeStep = steps?.find((s) => s.state === "active");

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="logo">
          <img src="/logo.svg" alt="" className="logo-mark" />
          Vulu FTBQuests Editor
        </strong>
        <button onClick={openFolder} disabled={!canOpen || busy} title={canOpen ? "" : t("This browser doesn't support folder access (use Chrome or Edge)")}>
          {t("Open modpack")}
        </button>
        <button className="secondary" onClick={() => load(async () => demoFileSystem())} disabled={busy}>
          Demo
        </button>
        {book && (
          <>
            <span className="path mono" title={book.fs.label}>
              {book.fs.label}
            </span>
            <span className="badge">{book.format.lang ? t("lang files (1.21+)") : t("classic SNBT (1.18–1.20)")}</span>
            {book.format.lang && (
              <select
                value={book.locale}
                onChange={(e) => book.setLocale(e.target.value)}

                title={t("Language being edited")}
              >
                {book.locales.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
            {book.issues.length > 0 && (
              <button className="warning" onClick={() => setShowIssues(!showIssues)}>
                ⚠ {t("{count} errors", { count: book.issues.length })}
              </button>
            )}
            {activeStep && !overlay ? (
              <span className="badge dim">
                <span className="spinner small" /> {t(activeStep.label)} {activeStep.detail}
              </span>
            ) : (
              assetStatus && (
                <span className="badge dim" title={assetStatus.title}>
                  {assetStatus.text}
                </span>
              )
            )}
            <span className="spacer" />
            <button className="secondary" onClick={() => setChoosingMode(true)} title={t("Simple / advanced editing")}>
              {t("Mode")}: {mode === "advanced" ? t("Advanced") : t("Simple")}
            </button>
            <button className="secondary" disabled={!book.canUndo} onClick={() => book.undo()} title={book.undoLabel ? t("Undo: {action}", { action: t(book.undoLabel) }) : ""}>
              ↶ {t("Undo")}
            </button>
            <button className="secondary" disabled={!book.canRedo} onClick={() => book.redo()} title={book.redoLabel ? t("Redo: {action}", { action: t(book.redoLabel) }) : ""}>
              ↷ {t("Redo")}
            </button>
            <button onClick={save} disabled={!book.dirty || busy} className={book.dirty ? "primary" : undefined}>
              {book.dirty ? t("Save ({count})", { count: book.pendingChanges().written.length + book.pendingChanges().removed.length }) : t("Saved")}
            </button>
          </>
        )}
        {!book && <span className="spacer" />}
        <LanguageSelect />
      </header>

      {showIssues && book && (
        <div className="issues">
          {book.issues.map((i) => (
            <div key={i.path}>
              <span className="mono">{i.path}</span>: {i.message}
            </div>
          ))}
        </div>
      )}

      {!book ? (
        <Welcome canOpen={canOpen} onOpen={openFolder} onDemo={() => load(async () => demoFileSystem())} />
      ) : (
        <AssetsContext.Provider value={assets}>
        <ThemeBackdrop />
        <TranslationsContext.Provider value={book.translations}>
        <ContextMenuHost key={lang}>
          <Workspace
            book={book}
            version={version}
            mode={mode ?? "simple"}
            chapter={chapter}
            chapterId={chapterId}
            questId={questId}
            imageIndex={imageIndex}
            setChapterId={setChapterId}
            setQuestId={setQuestId}
            setImageIndex={setImageIndex}
            select={select}
            onError={onError}
          />
        </ContextMenuHost>
        </TranslationsContext.Provider>
        </AssetsContext.Provider>
      )}

      {(mode === null || choosingMode) && (
        <ModeChooser
          current={mode}
          onClose={mode ? () => setChoosingMode(false) : undefined}
          onChoose={(m) => {
            saveMode(m);
            setMode(m);
            setChoosingMode(false);
          }}
        />
      )}

      {overlay && steps && (
        <LoadingOverlay
          steps={steps}
          source={loadSource}
          onSkip={steps[0]?.state === "done" ? () => setOverlay(false) : undefined}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function Welcome({ canOpen, onOpen, onDemo }: { canOpen: boolean; onOpen(): void; onDemo(): void }) {
  return (
    <div className="welcome">
      <img src="/logo.svg" alt="" className="welcome-logo" />
      <h1>Vulu FTBQuests Editor</h1>
      <p>{t("Edit your quest book without starting the game. Minecraft 1.18 – 1.20.1 (1.21+ experimental).")}</p>
      <ol>
        <li>{t("Close the game (or server) first; if it saves while open, it can overwrite your changes.")}</li>
        <li>
          {t("Choose the modpack's instance folder (the one with mods and config in it, e.g. CurseForge\\Instances\\MyPack). Item icons, names and translations are read from there.")}
        </li>
        <li>
          {t("A backup is made automatically before every save, under")} <code>config/ftbquests/editor-backups</code>.
        </li>
      </ol>
      <div className="row">
        <button className="primary" onClick={onOpen} disabled={!canOpen}>
          {t("Open modpack folder")}
        </button>
        <button className="secondary" onClick={onDemo}>
          {t("Try the demo")}
        </button>
      </div>
      {!canOpen && <p className="hint">{t("This browser doesn't support folder access. Use Chrome, Edge or the desktop app.")}</p>}
    </div>
  );
}
