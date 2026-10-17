import { useMemo, useState } from "react";
import type { QuestBook } from "../../core/book";
import { getString } from "../../core/snbt";
import { fold } from "../../core/text";
import { questIconId } from "../hooks";
import { ItemIcon } from "../ItemIcon";
import { stripFormatting, useTranslate } from "../McText";
import { Modal } from "./Modal";
import { t } from "../../i18n";

const MAX_RESULTS = 60;

/** Search every quest of the book (title, chapter or id) and pick one. */
export function QuestPicker({ book, title, exclude, onPick, onClose }: { book: QuestBook; title: string; exclude: string[]; onPick(id: string): void; onClose(): void }) {
  const translate = useTranslate();
  const [query, setQuery] = useState("");

  const all = useMemo(
    () =>
      book.chapters.flatMap((c) => {
        const chapter = stripFormatting(translate(book.getText("chapter", c.root, "title"))) || getString(c.root, "filename") || "";
        return book.quests(c).map((q) => {
          const first = book.tasks(q)[0];
          const name = stripFormatting(translate(book.getText("quest", q, "title"))) || (first && book.itemId(first)) || getString(q, "id")!;
          return { id: getString(q, "id")!, name, chapter, icon: questIconId(book, q) };
        });
      }),
    [book, translate],
  );

  const needle = fold(query.trim());
  const results = all
    .filter((q) => !exclude.includes(q.id))
    .filter((q) => !needle || fold(`${q.name} ${q.chapter} ${q.id}`).includes(needle))
    .slice(0, MAX_RESULTS);

  return (
    <Modal title={title} onClose={onClose} width={520}>
      <input autoFocus value={query} placeholder={t("Search quests: title, chapter or ID")} onChange={(e) => setQuery(e.target.value)} />
      <div className="quest-pick-list">
        {results.map((q) => (
          <button key={q.id} className="quest-pick" onClick={() => onPick(q.id)}>
            <ItemIcon id={q.icon} size={20} fallback="" />
            <span className="quest-pick-name">{q.name}</span>
            <span className="quest-pick-chapter">{q.chapter}</span>
          </button>
        ))}
        {results.length === 0 && <p className="hint">{t("No matching quests.")}</p>}
      </div>
    </Modal>
  );
}
