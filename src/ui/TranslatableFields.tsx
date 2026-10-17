import { useState } from "react";
import type { ObjectKind, QuestBook, TextField as TextFieldName } from "../core/book";
import type { SnbtCompound } from "../core/snbt";
import { translateText, translationKey } from "../core/text";
import { TextArea, TextField } from "./inputs";
import { TranslationHint } from "./McText";
import { RichTextEditor } from "./RichTextEditor";

// Text fields for titles and descriptions. Formatted text is edited visually (colors and
// styles shown in place); texts written as `{translation.key}` show and edit what the game
// displays (in the pack's KubeJS lang file), with a switch to edit the key itself.

function Caption({ file, showingKey, onToggle }: { file?: string; showingKey: boolean; onToggle(): void }) {
  return (
    <span className="hint field-caption">
      {showingKey ? "Çeviri anahtarı düzenleniyor" : file ? <>Dil dosyası: <span className="mono">{file}</span></> : "Mod dosyasından gelen çeviri (düzenlenemez)"}
      {" · "}
      <button type="button" className="link-button" onClick={onToggle}>
        {showingKey ? "metni göster" : "anahtarı düzenle"}
      </button>
    </span>
  );
}

interface FieldProps {
  book: QuestBook;
  kind: ObjectKind;
  obj: SnbtCompound;
  field: Exclude<TextFieldName, "description">;
  placeholder?: string;
}

/** Title / subtitle. */
export function TranslatableTextField({ book, kind, obj, field, placeholder }: FieldProps) {
  const [showKey, setShowKey] = useState(false);
  const raw = book.getText(kind, obj, field);
  const key = translationKey(raw);
  const commitRaw = (v: string) => book.setText(kind, obj, field, v);

  if (!key) return <RichTextEditor value={raw} placeholder={placeholder} onCommit={commitRaw} />;
  if (showKey) {
    return (
      <>
        <TextField mono value={raw} onCommit={commitRaw} />
        <TranslationHint text={raw} />
        <Caption showingKey onToggle={() => setShowKey(false)} />
      </>
    );
  }
  const file = book.translationFile(key);
  const text = book.translation(key) ?? "";
  return (
    <>
      {file ? <RichTextEditor value={text} onCommit={(v) => book.setTranslation(key, v)} /> : <input value={text || "(çeviri bulunamadı)"} disabled />}
      <Caption file={file} showingKey={false} onToggle={() => setShowKey(true)} />
    </>
  );
}

/** Quest description: each `{key}` line is edited as its translation. */
export function TranslatableDescription({ book, kind, obj }: Omit<FieldProps, "field" | "placeholder">) {
  const [showKey, setShowKey] = useState(false);
  const raw = book.getText(kind, obj, "description");
  const hasKeys = raw.split("\n").some((l) => translationKey(l));
  const editable = hasKeys && book.descriptionEditable(kind, obj);
  const commitRaw = (v: string) => book.setText(kind, obj, "description", v);

  if (!hasKeys) return <RichTextEditor multiline value={raw} onCommit={commitRaw} />;
  if (!editable || showKey) {
    return (
      <>
        <TextArea mono rows={6} value={raw} onCommit={commitRaw} />
        <TranslationHint text={raw} />
        {editable && <Caption showingKey onToggle={() => setShowKey(false)} />}
      </>
    );
  }
  const firstKey = raw.split("\n").map(translationKey).find(Boolean)!;
  return (
    <>
      <RichTextEditor multiline value={translateText(raw, book.translations)} onCommit={(v) => book.setTranslatedDescription(kind, obj, v)} />
      <Caption file={book.translationFile(firstKey)} showingKey={false} onToggle={() => setShowKey(true)} />
    </>
  );
}
