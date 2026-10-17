import type { Chapter, QuestBook } from "../core/book";
import { QUEST_SHAPES } from "../core/registry";
import { getString, setString } from "../core/snbt";
import { Field, ItemField, TextField } from "./inputs";
import { initialImageSize } from "../core/imageImport";
import { useShapeOptions } from "./ItemIcon";
import { PngPicker } from "./PngPicker";
import { stripFormatting, useTranslate } from "./McText";
import { TranslatableTextField } from "./TranslatableFields";
import { RawEditor } from "./RawEditor";
import { t } from "../i18n";

interface Props {
  book: QuestBook;
  version: number;
  chapter: Chapter;
  onDeleted(): void;
  onImageAdded(index: number): void;
  onError(message: string): void;
}

export function ChapterPanel({ book, version, chapter, onDeleted, onImageAdded, onError }: Props) {
  const root = chapter.root;
  const translate = useTranslate();
  const shapes = useShapeOptions(QUEST_SHAPES);
  return (
    <div className="panel">
      <h2>{t("Chapter")}</h2>
      <div className="mono dim">{chapter.path}</div>

      <Field label={t("Title")}>
        <TranslatableTextField book={book} kind="chapter" obj={root} field="title" />
      </Field>
      <Field label={t("Icon")}>
        <ItemField value={book.itemId(root, "icon")} iconRef={book.iconRef(root, "icon")} placeholder={t("e.g. minecraft:oak_sapling")} onCommit={(v) => book.setItemId(root, v, "icon")} />
      </Field>
      <Field label={t("Group")}>
        <select value={getString(root, "group") ?? ""} onChange={(e) => book.edit("group", () => setString(root, "group", e.target.value), root)}>
          <option value="">{t("(no group)")}</option>
          {book.chapterGroups.map((g) => (
            <option key={getString(g, "id")} value={getString(g, "id")}>
              {stripFormatting(translate(book.getText("chapter_group", g, "title"))) || getString(g, "id")}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Default quest shape")}>
        <select value={getString(root, "default_quest_shape") ?? ""} onChange={(e) => book.edit("default shape", () => setString(root, "default_quest_shape", e.target.value), root)}>
          {shapes.map((s) => (
            <option key={s} value={s}>
              {s || t("(book default)")}
            </option>
          ))}
        </select>
      </Field>

      <h3>{t("Images")}</h3>
      <p className="hint">
        {t("This chapter has {count} images. Click one on the map to select it, drag it to move it.", { count: book.images(chapter).length })}
      </p>
      <div className="row wrap">
        <PngPicker
          book={book}
          label={t("+ Add image from computer")}
          onError={onError}
          onImported={(img) => {
            const size = initialImageSize(img.width, img.height);
            book.addImage(chapter, img.ref, 0, 0, size.width, size.height);
            onImageAdded(book.images(chapter).length - 1);
          }}
        />
        <button
          className="secondary"
          onClick={() => {
            book.addImage(chapter, "ftbquests:textures/item/book.png", 0, 0, 2, 2);
            onImageAdded(book.images(chapter).length - 1);
          }}
        >
          {t("+ Add with a texture from the pack")}
        </button>
      </div>
      <p className="hint">{t("New images are placed at (0, 0); drag them on the map to move them.")}</p>

      <h3>{t("Usage")}</h3>
      <ul className="help">
        <li>
          <b>{t("Double-click empty space")}</b>: {t("new quest")}
        </li>
        <li>
          <b>{t("Drag from the dot on a quest's right")}</b>: {t("dependency")}
        </li>
        <li>
          <b>{t("Select + Delete")}</b>: {t("delete a quest or line")}
        </li>
        <li>
          <b>{t("Shift + drag")}</b>: {t("select several")}
        </li>
        <li>
          <b>Ctrl+Z / Ctrl+Y</b>: {t("undo / redo")}, <b>Ctrl+S</b>: {t("save")}
        </li>
      </ul>

      <h3>{t("Advanced")}</h3>
      <RawEditor book={book} target={root} version={version} />
      <button
        className="danger"
        onClick={() => {
          if (window.confirm(t("Delete the chapter \"{name}\" and all its quests? (You can undo this)", { name: book.getText("chapter", root, "title") || chapter.path }))) {
            book.deleteChapter(chapter);
            onDeleted();
          }
        }}
      >
        {t("Delete chapter")}
      </button>
    </div>
  );
}
