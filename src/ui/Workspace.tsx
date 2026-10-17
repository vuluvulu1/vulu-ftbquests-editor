import { ReactFlowProvider } from "@xyflow/react";
import { useContext, useRef, useState, type MouseEvent } from "react";
import type { Chapter, QuestBook } from "../core/book";
import { importPng, initialImageSize } from "../core/imageImport";
import { TASK_TYPES, taskSpec, taskTypeIcon } from "../core/registry";
import { getString } from "../core/snbt";
import { ChapterList } from "./ChapterList";
import { ChapterPanel } from "./ChapterPanel";
import { ImagePanel } from "./ImagePanel";
import { AssetsContext } from "./ItemIcon";
import { stripFormatting, useTranslate } from "./McText";
import { QuestMap, type MapActions } from "./QuestMap";
import { QuestPanel } from "./QuestPanel";
import { useContextMenu, type MenuItem } from "./simple/ContextMenu";
import { ItemPicker } from "./simple/ItemPicker";
import { Modal } from "./simple/Modal";
import type { EditorMode } from "./simple/mode";
import { QuestView } from "./simple/QuestView";
import { t } from "../i18n";

interface Props {
  book: QuestBook;
  version: number;
  mode: EditorMode;
  chapter: Chapter | undefined;
  chapterId: string | null;
  questId: string | null;
  imageIndex: number | null;
  setChapterId(id: string | null): void;
  setQuestId(id: string | null): void;
  setImageIndex(index: number | null): void;
  /** Selects a quest, switching chapter if given. */
  select(id: string | null, inChapter?: string): void;
  onError(message: string): void;
}

/** Chapter list + quest map + (advanced) side panel or (simple) in-game style menus and windows. */
export function Workspace(props: Props) {
  const { book, version, mode, chapter, chapterId, questId, imageIndex, setChapterId, setQuestId, setImageIndex, select, onError } = props;
  const simple = mode === "simple";
  const menu = useContextMenu();
  const assets = useContext(AssetsContext);
  const translate = useTranslate();

  // Simple mode windows
  const [openQuest, setOpenQuest] = useState<string | null>(null);
  const [settingsQuest, setSettingsQuest] = useState<string | null>(null);
  const [imageDialog, setImageDialog] = useState<number | null>(null);
  const [chapterDialog, setChapterDialog] = useState(false);
  const [picker, setPicker] = useState<((id: string) => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imagePos = useRef({ x: 0, y: 0 });

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const createQuest = (x: number, y: number, type: string, itemId?: string) => {
    if (!chapter) return;
    const quest = book.edit(
      "add quest",
      () => {
        const q = book.addQuest(chapter, x, y);
        const task = book.addTask(q, type);
        if (itemId) book.setItemId(task, itemId);
        return q;
      },
      chapter.root,
    );
    const id = getString(quest, "id")!;
    setQuestId(id);
    if (simple) setOpenQuest(id);
  };

  /** Short readable quest name for menus. */
  const questName = (id: string) => {
    const q = book.quest(id)?.quest;
    const title = q ? stripFormatting(translate(book.getText("quest", q, "title"))) : "";
    const first = q ? book.tasks(q)[0] : undefined;
    const name = title || (first && book.itemId(first)) || id;
    return name.length > 32 ? `${name.slice(0, 31)}…` : name;
  };

  const actions: MapActions = {
    openQuest: (id) => (simple ? setOpenQuest(id) : undefined),
    openImage: (index) => (simple ? setImageDialog(index) : setImageIndex(index)),

    paneMenu(e: MouseEvent, x: number, y: number) {
      if (!chapter) return;
      const items: MenuItem[] = [
        { kind: "header", label: t("New quest") },
        ...TASK_TYPES.map((spec) => ({
          label: t(spec.label),
          icon: spec.type === "item" ? "minecraft:chest" : taskTypeIcon(spec.type),
          onClick: () => {
            if (taskSpec(spec.type)?.hasItem) setPicker(() => (id: string) => run(() => createQuest(x, y, spec.type, id)));
            else run(() => createQuest(x, y, spec.type));
          },
        })),
        { kind: "separator" },
        {
          label: t("Add image (from computer)"),
          icon: "minecraft:painting",
          disabled: !assets?.index.hasWritableSource || !book.canAddTextures,
          onClick: () => {
            imagePos.current = { x, y };
            fileInput.current?.click();
          },
        },
        {
          label: t("Add image (texture from the pack)"),
          icon: "minecraft:item_frame",
          onClick: () => {
            book.addImage(chapter, "ftbquests:textures/item/book.png", x, y, 2, 2);
            const index = book.images(chapter).length - 1;
            if (simple) setImageDialog(index);
            else setImageIndex(index);
          },
        },
        { kind: "separator" },
        { label: t("Chapter settings"), icon: "texture:ftbquests:textures/gui/settings.png", onClick: () => (simple ? setChapterDialog(true) : select(null)) },
      ];
      menu(e.clientX, e.clientY, items);
    },

    nodeMenu(e: MouseEvent, nodeId: string, selection: string[]) {
      if (!chapter) return;
      if (nodeId.startsWith("img:")) {
        const index = Number(nodeId.slice(4));
        const img = book.images(chapter)[index];
        if (!img) return;
        menu(e.clientX, e.clientY, [
          { label: t("Edit"), icon: "texture:ftbquests:textures/gui/settings.png", onClick: () => actions.openImage(index) },
          { label: t("Delete"), danger: true, onClick: () => book.deleteImage(chapter, img) },
        ]);
        return;
      }
      if (nodeId.startsWith("link:")) {
        const link = book.questLinks(chapter).find((l) => getString(l, "id") === nodeId.slice(5));
        const target = link && getString(link, "linked_quest");
        menu(e.clientX, e.clientY, [{ label: t("Open linked quest"), disabled: !target || !book.quest(target), onClick: () => target && setOpenQuest(target) }]);
        return;
      }
      const target = book.quest(nodeId);
      if (!target) return;
      const others = selection.filter((s) => s !== nodeId && book.quest(s));
      const deps = book.dependencies(target.quest);
      const items: MenuItem[] = [
        { label: t("Open"), icon: "texture:ftbquests:textures/item/book.png", onClick: () => (simple ? setOpenQuest(nodeId) : setQuestId(nodeId)) },
        { label: t("Settings"), icon: "texture:ftbquests:textures/gui/settings.png", onClick: () => (simple ? setSettingsQuest(nodeId) : setQuestId(nodeId)) },
      ];
      if (others.length > 0) {
        items.push(
          { kind: "separator" },
          {
            label:
              others.length === 1
                ? t("Make \"{name}\" a requirement of this quest", { name: questName(others[0]!) })
                : t("Make the {count} selected quests requirements of this quest", { count: others.length }),
            icon: "texture:ftbquests:textures/gui/dependency.png",
            onClick: () => run(() => book.edit("add dependency", () => others.forEach((o) => book.addDependency(target.quest, o)), target.quest)),
          },
        );
        if (others.some((o) => deps.includes(o))) {
          items.push({
            label: t("Remove the selected quests from its requirements"),
            onClick: () => book.edit("remove dependency", () => others.forEach((o) => book.removeDependency(target.quest, o)), target.quest),
          });
        }
      } else {
        items.push({ kind: "header", label: t("To add requirements, first select quests with Ctrl+click") });
      }
      if (deps.length > 0) {
        items.push({
          label: t("Clear its requirements ({count})", { count: deps.length }),
          onClick: () => book.edit("clear dependencies", () => deps.forEach((d) => book.removeDependency(target.quest, d)), target.quest),
        });
      }
      items.push(
        { kind: "separator" },
        { label: t("Copy ID"), onClick: () => void navigator.clipboard?.writeText(nodeId) },
        {
          label: t("Delete"),
          danger: true,
          onClick: () => {
            if (window.confirm(t("Delete this quest? (You can undo this)"))) {
              book.deleteQuest(nodeId);
              setOpenQuest(null);
            }
          },
        },
      );
      menu(e.clientX, e.clientY, items);
    },
  };

  const selectedImage = chapter && imageIndex !== null ? book.images(chapter)[imageIndex] : undefined;
  const dialogImage = chapter && imageDialog !== null ? book.images(chapter)[imageDialog] : undefined;

  return (
    <main className={`workspace ${mode}`}>
      <ChapterList
        book={book}
        selected={chapterId}
        onSelect={(id) => select(null, id)}
        onEdit={(id) => {
          select(null, id);
          if (simple) setChapterDialog(true);
        }}
      />
      {chapter ? (
        <ReactFlowProvider>
          <QuestMap
            key={chapter.path}
            book={book}
            chapter={chapter}
            version={version}
            simple={simple}
            actions={actions}
            selectedQuest={questId}
            selectedImage={imageIndex}
            onSelect={setQuestId}
            onSelectImage={setImageIndex}
            onError={onError}
          />
        </ReactFlowProvider>
      ) : (
        <div className="map panel-empty">{t("Select a chapter or add a new one.")}</div>
      )}

      {!simple && (
        <aside className="inspector">
          {questId ? (
            <QuestPanel book={book} version={version} questId={questId} onSelect={select} onError={onError} />
          ) : chapter && selectedImage ? (
            <ImagePanel key={imageIndex} book={book} version={version} chapter={chapter} image={selectedImage} onDeleted={() => setImageIndex(null)} onError={onError} />
          ) : chapter ? (
            <ChapterPanel book={book} version={version} chapter={chapter} onDeleted={() => setChapterId(null)} onImageAdded={setImageIndex} onError={onError} />
          ) : null}
        </aside>
      )}

      {simple && openQuest && book.quest(openQuest) && (
        <QuestView
          book={book}
          version={version}
          questId={openQuest}
          onClose={() => setOpenQuest(null)}
          onOpenSettings={() => setSettingsQuest(openQuest)}
          onError={onError}
        />
      )}
      {simple && settingsQuest && book.quest(settingsQuest) && (
        <Modal title={t("Quest settings")} onClose={() => setSettingsQuest(null)} width={520} className="settings-modal">
          <QuestPanel
            book={book}
            version={version}
            questId={settingsQuest}
            onError={onError}
            onSelect={(id, inChapter) => {
              setSettingsQuest(null);
              select(id, inChapter);
              if (id) setOpenQuest(id);
            }}
          />
        </Modal>
      )}
      {simple && chapter && dialogImage && (
        <Modal title={t("Image")} onClose={() => setImageDialog(null)} width={480} className="settings-modal">
          <ImagePanel key={imageDialog} book={book} version={version} chapter={chapter} image={dialogImage} onDeleted={() => setImageDialog(null)} onError={onError} />
        </Modal>
      )}
      {simple && chapter && chapterDialog && (
        <Modal title={t("Chapter settings")} onClose={() => setChapterDialog(false)} width={480} className="settings-modal">
          <ChapterPanel
            book={book}
            version={version}
            chapter={chapter}
            onDeleted={() => {
              setChapterDialog(false);
              setChapterId(null);
            }}
            onImageAdded={(index) => {
              setChapterDialog(false);
              setImageDialog(index);
            }}
            onError={onError}
          />
        </Modal>
      )}
      {picker && (
        <ItemPicker
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const done = picker;
            setPicker(null);
            done(id);
          }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !assets || !chapter) return;
          try {
            const img = importPng(book, assets.index, file.name, new Uint8Array(await file.arrayBuffer()));
            const size = initialImageSize(img.width, img.height);
            book.addImage(chapter, img.ref, imagePos.current.x, imagePos.current.y, size.width, size.height);
            const index = book.images(chapter).length - 1;
            if (simple) setImageDialog(index);
            else setImageIndex(index);
          } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </main>
  );
}
