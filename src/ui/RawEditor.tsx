import { useEffect, useState } from "react";
import type { QuestBook } from "../core/book";
import { parseSnbt, writeSnbt, type SnbtCompound } from "../core/snbt";
import { t } from "../i18n";

/** Edits any compound as SNBT text. Covers every field the forms do not know about. */
export function RawEditor({ book, target, version }: { book: QuestBook; target: SnbtCompound; version: number }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(writeSnbt(target));
    setError(null);
  }, [target, version, open]);

  if (!open) {
    return (
      <button className="link-button" onClick={() => setOpen(true)}>
        {t("Edit raw SNBT…")}
      </button>
    );
  }

  const apply = () => {
    try {
      const parsed = parseSnbt(text);
      if (parsed.kind !== "compound") throw new Error(t("The root value must be { }"));
      book.replaceContents(target, parsed as SnbtCompound);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="raw-editor">
      <textarea className="mono" rows={Math.min(24, text.split("\n").length + 1)} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button onClick={apply}>{t("Apply")}</button>
        <button className="secondary" onClick={() => setOpen(false)}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}
