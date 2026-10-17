import type { Chapter, QuestBook } from "../core/book";
import { getBool, getNumber, getString, setFlag, setNumber, setString, setStrings, strings, type SnbtCompound } from "../core/snbt";
import { Field, NumberField, TextArea, TextField } from "./inputs";
import { useTextureImage } from "./ItemIcon";
import { stripFormatting, useTranslate } from "./McText";
import { PngPicker } from "./PngPicker";
import { RawEditor } from "./RawEditor";

interface Props {
  book: QuestBook;
  version: number;
  chapter: Chapter;
  image: SnbtCompound;
  onDeleted(): void;
  onError(message: string): void;
}

/** Editor for one chapter image (FTB "images" entry). */
export function ImagePanel({ book, version, chapter, image, onDeleted, onError }: Props) {
  const translate = useTranslate();
  const ref = getString(image, "image") ?? "";
  const url = useTextureImage(ref || undefined);
  const edit = (label: string, fn: () => void) => book.edit(label, fn, chapter.root);
  const num = (key: string, fallback: number) => getNumber(image, key) ?? fallback;
  const dependency = getString(image, "dependency") ?? "";
  const quests = book.quests(chapter).map((q) => ({
    id: getString(q, "id")!,
    label: stripFormatting(translate(book.getText("quest", q, "title"))) || getString(q, "id")!,
  }));

  return (
    <div className="panel">
      <h2>Resim</h2>
      <div className="image-preview">{url ? <img src={url} alt="" /> : <span className="hint">{url === null ? "Resim bulunamadı" : "…"}</span>}</div>

      <Field label="Resim yolu" hint="ör. modpack:textures/opened_letter.png ya da minecraft:item/diamond">
        <TextField mono value={ref} onCommit={(v) => edit("resim yolu", () => setString(image, "image", v.trim()))} />
      </Field>
      <PngPicker
        book={book}
        label="Bilgisayardan PNG seç…"
        onError={onError}
        onImported={(img) =>
          // keep the width, follow the new picture's aspect ratio
          edit("resim değiştir", () => {
            setString(image, "image", img.ref);
            setNumber(image, "height", Math.round(((num("width", 1) * img.height) / img.width) * 100) / 100, "double");
          })
        }
      />

      <div className="grid-2">
        <Field label="Genişlik">
          <NumberField step={0.1} value={num("width", 1)} onCommit={(v) => edit("genişlik", () => setNumber(image, "width", v, "double"))} />
        </Field>
        <Field label="Yükseklik">
          <NumberField step={0.1} value={num("height", 1)} onCommit={(v) => edit("yükseklik", () => setNumber(image, "height", v, "double"))} />
        </Field>
        <Field label="X">
          <NumberField step={0.5} value={num("x", 0)} onCommit={(v) => edit("konum", () => setNumber(image, "x", v, "double"))} />
        </Field>
        <Field label="Y">
          <NumberField step={0.5} value={num("y", 0)} onCommit={(v) => edit("konum", () => setNumber(image, "y", v, "double"))} />
        </Field>
        <Field label="Döndürme (°)">
          <NumberField step={5} value={num("rotation", 0)} onCommit={(v) => edit("döndürme", () => setNumber(image, "rotation", v, "double"))} />
        </Field>
        <Field label="Opaklık (0–255)">
          <NumberField
            integer
            value={num("alpha", 255)}
            onCommit={(v) =>
              edit("opaklık", () => {
                const alpha = Math.max(0, Math.min(255, v));
                if (alpha === 255) image.entries.delete("alpha");
                else setNumber(image, "alpha", alpha, "int");
              })
            }
          />
        </Field>
      </div>

      <label className="check">
        <input type="checkbox" checked={getBool(image, "corner") ?? false} onChange={(e) => edit("köşe", () => setFlag(image, "corner", e.target.checked))} />
        X/Y sol üst köşeyi gösterir (yoksa merkez)
      </label>

      <Field label="Görünme koşulu" hint="Seçilirse resim oyunda ancak bu görev tamamlanınca görünür (ör. açılan mektup).">
        <select value={dependency} onChange={(e) => edit("koşul", () => (e.target.value ? setString(image, "dependency", e.target.value) : image.entries.delete("dependency")))}>
          <option value="">Her zaman görünür</option>
          {dependency && !quests.some((q) => q.id === dependency) && <option value={dependency}>{dependency} (başka bölüm)</option>}
          {quests.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Sıra" hint="Büyük olan üstte çizilir; 0'dan büyükse görevlerin üstünde durur.">
        <NumberField integer value={num("order", 0)} onCommit={(v) => edit("sıra", () => (v === 0 ? image.entries.delete("order") : setNumber(image, "order", v, "int")))} />
      </Field>

      <Field label="Fareyle üzerine gelince yazısı" hint="Her satır ayrı satır olarak gösterilir.">
        <TextArea rows={3} value={strings(image.entries.get("hover")).join("\n")} onCommit={(v) => edit("açıklama", () => setStrings(image, "hover", v ? v.split("\n") : []))} />
      </Field>

      <label className="check">
        <input type="checkbox" checked={getBool(image, "dev") ?? false} onChange={(e) => edit("geliştirici", () => setFlag(image, "dev", e.target.checked))} />
        Sadece düzenleme modunda görünür
      </label>

      <h3>Gelişmiş</h3>
      <RawEditor book={book} target={image} version={version} />
      <button
        className="danger"
        onClick={() => {
          book.deleteImage(chapter, image);
          onDeleted();
        }}
      >
        Resmi sil
      </button>
    </div>
  );
}
