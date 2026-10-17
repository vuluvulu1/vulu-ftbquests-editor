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
      <h2>Bölüm</h2>
      <div className="mono dim">{chapter.path}</div>

      <Field label="Başlık">
        <TranslatableTextField book={book} kind="chapter" obj={root} field="title" />
      </Field>
      <Field label="Simge">
        <ItemField value={book.itemId(root, "icon")} iconRef={book.iconRef(root, "icon")} placeholder="ör. minecraft:oak_sapling" onCommit={(v) => book.setItemId(root, v, "icon")} />
      </Field>
      <Field label="Grup">
        <select value={getString(root, "group") ?? ""} onChange={(e) => book.edit("grup", () => setString(root, "group", e.target.value), root)}>
          <option value="">(grupsuz)</option>
          {book.chapterGroups.map((g) => (
            <option key={getString(g, "id")} value={getString(g, "id")}>
              {stripFormatting(translate(book.getText("chapter_group", g, "title"))) || getString(g, "id")}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Varsayılan görev şekli">
        <select value={getString(root, "default_quest_shape") ?? ""} onChange={(e) => book.edit("varsayılan şekil", () => setString(root, "default_quest_shape", e.target.value), root)}>
          {shapes.map((s) => (
            <option key={s} value={s}>
              {s || "(kitap varsayılanı)"}
            </option>
          ))}
        </select>
      </Field>

      <h3>Resimler</h3>
      <p className="hint">
        Bu bölümde {book.images(chapter).length} resim var. Haritada tıklayıp seçebilir, sürükleyip taşıyabilirsiniz.
      </p>
      <div className="row wrap">
        <PngPicker
          book={book}
          label="+ Bilgisayardan resim ekle"
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
          + Paketteki bir dokuyla ekle
        </button>
      </div>
      <p className="hint">Eklenen resim (0, 0) konumuna yerleşir; haritada sürükleyerek taşıyın.</p>

      <h3>Kullanım</h3>
      <ul className="help">
        <li>Boş alana <b>çift tıkla</b>: yeni görev</li>
        <li>Görevin sağındaki <b>noktadan sürükle</b>: bağımlılık</li>
        <li>Seç + <b>Delete</b>: görev veya bağlantıyı sil</li>
        <li><b>Shift + sürükle</b>: çoklu seçim</li>
        <li><b>Ctrl+Z / Ctrl+Y</b>: geri al / yinele, <b>Ctrl+S</b>: kaydet</li>
      </ul>

      <h3>Gelişmiş</h3>
      <RawEditor book={book} target={root} version={version} />
      <button
        className="danger"
        onClick={() => {
          if (window.confirm(`"${book.getText("chapter", root, "title") || chapter.path}" bölümü ve tüm görevleri silinsin mi? (Geri alınabilir)`)) {
            book.deleteChapter(chapter);
            onDeleted();
          }
        }}
      >
        Bölümü sil
      </button>
    </div>
  );
}
