import { useState } from "react";
import type { Chapter, QuestBook } from "../core/book";
import { getString } from "../core/snbt";
import { shortItem } from "./hooks";
import { ItemIcon } from "./ItemIcon";
import { McText } from "./McText";
import { useContextMenu } from "./simple/ContextMenu";

interface Props {
  book: QuestBook;
  selected: string | null;
  onSelect(chapterId: string): void;
  /** Opens the chapter's settings (a window in simple mode, the side panel in advanced). */
  onEdit(chapterId: string): void;
}

/** The chapter panel: groups with their chapters; green "+" and right-click menus as in game. */
export function ChapterList({ book, selected, onSelect, onEdit }: Props) {
  const menu = useContextMenu();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const chapters = book.chapters;
  const groups = [
    { id: "", title: "" },
    ...book.chapterGroups.map((g) => ({ id: getString(g, "id") ?? "", title: book.getText("chapter_group", g, "title") })),
  ];
  const groupIds = new Set(groups.map((g) => g.id));
  const chaptersOf = (groupId: string) =>
    chapters.filter((c) => {
      const g = getString(c.root, "group") ?? "";
      return g === groupId || (groupId === "" && !groupIds.has(g));
    });

  const add = () => {
    const chapter = book.addChapter(title.trim() || "Yeni Bölüm");
    setTitle("");
    setAdding(false);
    onSelect(chapter.id);
  };

  const row = (c: Chapter) => {
    const index = chapters.indexOf(c);
    const name = book.getText("chapter", c.root, "title") || getString(c.root, "filename") || "";
    return (
      <li
        key={c.path}
        className={c.id === selected ? "active" : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          menu(e.clientX, e.clientY, [
            { label: "Aç", onClick: () => onSelect(c.id) },
            { label: "Düzenle", icon: "texture:ftbquests:textures/gui/settings.png", onClick: () => onEdit(c.id) },
            { kind: "separator" },
            { label: "Yukarı taşı", icon: "texture:ftblibrary:textures/icons/up.png", disabled: index === 0, onClick: () => book.moveChapter(c, index - 1) },
            {
              label: "Aşağı taşı",
              icon: "texture:ftblibrary:textures/icons/down.png",
              disabled: index === chapters.length - 1,
              onClick: () => book.moveChapter(c, index + 1),
            },
            { kind: "separator" },
            {
              label: "Sil",
              danger: true,
              onClick: () => {
                if (window.confirm("Bu bölüm ve tüm görevleri silinsin mi? (Geri alınabilir)")) book.deleteChapter(c);
              },
            },
          ]);
        }}
      >
        <button className="chapter-button" onClick={() => onSelect(c.id)}>
          <span className="chapter-icon">
            <ItemIcon id={book.iconRef(c.root, "icon") || undefined} size={22} fallback={shortItem(book.itemId(c.root, "icon")).slice(0, 3) || "•"} />
          </span>
          <span className="chapter-name">
            <McText text={name} />
          </span>
          <span className="count">{book.quests(c).length}</span>
        </button>
      </li>
    );
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <span>Bölümler</span>
        <button className="add-green" title="Yeni bölüm" onClick={() => setAdding(true)}>
          +
        </button>
      </div>
      {adding && (
        <div className="add-chapter">
          <input
            autoFocus
            value={title}
            placeholder="Bölüm adı"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button onClick={add}>Ekle</button>
        </div>
      )}
      {groups.map((g) => {
        const list = chaptersOf(g.id);
        if (g.id !== "" && list.length === 0) return null;
        return (
          <section key={g.id}>
            {g.id !== "" && (
              <h4>
                <McText text={g.title || g.id} />
              </h4>
            )}
            <ul>{list.map(row)}</ul>
          </section>
        );
      })}
      <p className="hint sidebar-hint">Bölüme sağ tıklayarak taşıyabilir, düzenleyebilir veya silebilirsin.</p>
    </nav>
  );
}
