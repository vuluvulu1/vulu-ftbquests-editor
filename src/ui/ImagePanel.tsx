import type { Chapter, QuestBook } from "../core/book";
import { getBool, getNumber, getString, setFlag, setNumber, setString, setStrings, strings, type SnbtCompound } from "../core/snbt";
import { Field, NumberField, TextArea, TextField } from "./inputs";
import { useTextureImage } from "./ItemIcon";
import { stripFormatting, useTranslate } from "./McText";
import { PngPicker } from "./PngPicker";
import { RawEditor } from "./RawEditor";
import { t } from "../i18n";

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
      <h2>{t("Image")}</h2>
      <div className="image-preview">{url ? <img src={url} alt="" /> : <span className="hint">{url === null ? t("Image not found") : "…"}</span>}</div>

      <Field label={t("Image path")} hint={t("e.g. modpack:textures/opened_letter.png or minecraft:item/diamond")}>
        <TextField mono value={ref} onCommit={(v) => edit("image path", () => setString(image, "image", v.trim()))} />
      </Field>
      <PngPicker
        book={book}
        label={t("Choose a PNG from your computer…")}
        onError={onError}
        onImported={(img) =>
          // keep the width, follow the new picture's aspect ratio
          edit("change image", () => {
            setString(image, "image", img.ref);
            setNumber(image, "height", Math.round(((num("width", 1) * img.height) / img.width) * 100) / 100, "double");
          })
        }
      />

      <div className="grid-2">
        <Field label={t("Width")}>
          <NumberField step={0.1} value={num("width", 1)} onCommit={(v) => edit("width", () => setNumber(image, "width", v, "double"))} />
        </Field>
        <Field label={t("Height")}>
          <NumberField step={0.1} value={num("height", 1)} onCommit={(v) => edit("height", () => setNumber(image, "height", v, "double"))} />
        </Field>
        <Field label="X">
          <NumberField step={0.5} value={num("x", 0)} onCommit={(v) => edit("position", () => setNumber(image, "x", v, "double"))} />
        </Field>
        <Field label="Y">
          <NumberField step={0.5} value={num("y", 0)} onCommit={(v) => edit("position", () => setNumber(image, "y", v, "double"))} />
        </Field>
        <Field label={t("Rotation (°)")}>
          <NumberField step={5} value={num("rotation", 0)} onCommit={(v) => edit("rotation", () => setNumber(image, "rotation", v, "double"))} />
        </Field>
        <Field label={t("Opacity (0–255)")}>
          <NumberField
            integer
            value={num("alpha", 255)}
            onCommit={(v) =>
              edit("opacity", () => {
                const alpha = Math.max(0, Math.min(255, v));
                if (alpha === 255) image.entries.delete("alpha");
                else setNumber(image, "alpha", alpha, "int");
              })
            }
          />
        </Field>
      </div>

      <label className="check">
        <input type="checkbox" checked={getBool(image, "corner") ?? false} onChange={(e) => edit("corner", () => setFlag(image, "corner", e.target.checked))} />
        {t("X/Y is the top-left corner (otherwise the center)")}
      </label>

      <Field label={t("Visibility condition")} hint={t("If set, the image only appears in game once this quest is complete (e.g. an opened letter).")}>
        <select value={dependency} onChange={(e) => edit("condition", () => (e.target.value ? setString(image, "dependency", e.target.value) : image.entries.delete("dependency")))}>
          <option value="">{t("Always visible")}</option>
          {dependency && !quests.some((q) => q.id === dependency) && <option value={dependency}>{dependency} ({t("other chapter")})</option>}
          {quests.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("Order")} hint={t("Higher is drawn on top; above 0 it sits over the quests.")}>
        <NumberField integer value={num("order", 0)} onCommit={(v) => edit("order", () => (v === 0 ? image.entries.delete("order") : setNumber(image, "order", v, "int")))} />
      </Field>

      <Field label={t("Hover text")} hint={t("Each line is shown on its own line.")}>
        <TextArea rows={3} value={strings(image.entries.get("hover")).join("\n")} onCommit={(v) => edit("hover text", () => setStrings(image, "hover", v ? v.split("\n") : []))} />
      </Field>

      <label className="check">
        <input type="checkbox" checked={getBool(image, "dev") ?? false} onChange={(e) => edit("dev only", () => setFlag(image, "dev", e.target.checked))} />
        {t("Only visible in edit mode")}
      </label>

      <h3>{t("Advanced")}</h3>
      <RawEditor book={book} target={image} version={version} />
      <button
        className="danger"
        onClick={() => {
          book.deleteImage(chapter, image);
          onDeleted();
        }}
      >
        {t("Delete image")}
      </button>
    </div>
  );
}
