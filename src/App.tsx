import { useCallback, useEffect, useRef, useState } from "react";
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
    if (book?.dirty && !window.confirm("Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?")) return;
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
      step("book", { state: "done", detail: `${loaded.chapters.length} bölüm, ${questCount} görev` });
      if (loaded.issues.length > 0) notify("error", `${loaded.issues.length} dosya okunamadı; bu dosyalara dokunulmayacak.`);
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
      setAssetStatus({ text: "İkon yok", title: "Instance'ın mods klasörüne ulaşılamadı." });
      return;
    }
    const index = await AssetIndex.build(bundle.archives, (p) => step("index", { detail: `${p.done}/${p.total}` }));
    if (!current()) return;
    const assets = new ItemAssets(index);
    setAssets(assets);
    step("index", { state: "done", detail: `${index.archives} kaynak` });

    step("texts", { state: "active" });
    const keys = loaded.translationKeys();
    const translations = await assets.translations(keys, (d, t) => step("texts", { detail: `${d}/${t}` }));
    if (!current()) return;
    await loaded.attachTranslations(translations);
    step("texts", { state: "done", detail: keys.size ? `${translations.size}/${keys.size} metin` : "gerekmiyor" });

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
      !bundle.vanilla && "Vanilla Minecraft jar'ı bulunamadı: minecraft: eşyalarının ikonları eksik olacak.",
      index.issues.length > 0 && `${index.issues.length} dosya okunamadı: ${index.issues.map((i) => i.file).join(", ")}`,
      keys.size > translations.size && `${keys.size - translations.size} çeviri anahtarı dil dosyalarında bulunamadı.`,
    ].filter(Boolean);
    setAssetStatus({
      text: `${warnings.length ? "⚠ " : ""}${index.archives} kaynak`,
      title: [`Minecraft ${bundle.version ?? "?"}, ${index.size} dosya`, ...warnings].join("\n"),
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
      notify("info", `${count} dosya kaydedildi.${result.backup ? ` Yedek: ${result.backup}` : ""}`);
    } catch (e) {
      notify("error", `Kaydetme başarısız: ${e instanceof Error ? e.message : String(e)}`);
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
        <strong className="logo">Vulu FTBQuests Editor</strong>
        <button onClick={openFolder} disabled={!canOpen || busy} title={canOpen ? "" : "Bu tarayıcı klasör erişimini desteklemiyor (Chrome/Edge kullanın)"}>
          Mod paketi aç
        </button>
        <button className="secondary" onClick={() => load(async () => demoFileSystem())} disabled={busy}>
          Demo
        </button>
        {book && (
          <>
            <span className="path mono" title={book.fs.label}>
              {book.fs.label}
            </span>
            <span className="badge">{book.format.lang ? "lang dosyalı (1.21+)" : "klasik SNBT (1.18–1.20)"}</span>
            {book.format.lang && (
              <select
                value={book.locale}
                onChange={(e) => book.setLocale(e.target.value)}

                title="Düzenlenen dil"
              >
                {book.locales.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            )}
            {book.issues.length > 0 && (
              <button className="warning" onClick={() => setShowIssues(!showIssues)}>
                ⚠ {book.issues.length} hata
              </button>
            )}
            {activeStep && !overlay ? (
              <span className="badge dim">
                <span className="spinner small" /> {activeStep.label} {activeStep.detail}
              </span>
            ) : (
              assetStatus && (
                <span className="badge dim" title={assetStatus.title}>
                  {assetStatus.text}
                </span>
              )
            )}
            <span className="spacer" />
            <button className="secondary" onClick={() => setChoosingMode(true)} title="Basit / gelişmiş düzenleme">
              Mod: {mode === "advanced" ? "Gelişmiş" : "Basit"}
            </button>
            <button className="secondary" disabled={!book.canUndo} onClick={() => book.undo()} title={book.undoLabel ? `Geri al: ${book.undoLabel}` : ""}>
              ↶ Geri al
            </button>
            <button className="secondary" disabled={!book.canRedo} onClick={() => book.redo()} title={book.redoLabel ? `Yinele: ${book.redoLabel}` : ""}>
              ↷ Yinele
            </button>
            <button onClick={save} disabled={!book.dirty || busy} className={book.dirty ? "primary" : undefined}>
              {book.dirty ? `Kaydet (${book.pendingChanges().written.length + book.pendingChanges().removed.length})` : "Kaydedildi"}
            </button>
          </>
        )}
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
        <ContextMenuHost>
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
      <h1>Vulu FTBQuests Editor</h1>
      <p>Görev kitabını oyuna girmeden düzenleyin. Minecraft 1.20 ve üzeri.</p>
      <ol>
        <li>Oyunu (veya sunucuyu) kapatın; açıkken kaydederse değişiklikleriniz ezilebilir.</li>
        <li>
          Mod paketinin <b>instance klasörünü</b> seçin (içinde <code>mods</code> ve <code>config</code> olan, ör.{" "}
          <code>CurseForge\Instances\PaketAdı</code>). Eşya ikonları, isimleri ve çeviriler oradan okunur.
        </li>
        <li>Kaydetmeden önce otomatik yedek <code>config/ftbquests/editor-backups</code> altına alınır.</li>
      </ol>
      <div className="row">
        <button className="primary" onClick={onOpen} disabled={!canOpen}>
          Mod paketi klasörünü aç
        </button>
        <button className="secondary" onClick={onDemo}>
          Demo ile dene
        </button>
      </div>
      {!canOpen && <p className="hint">Bu tarayıcı klasör erişimini desteklemiyor. Chrome/Edge veya masaüstü uygulamasını kullanın.</p>}
    </div>
  );
}
