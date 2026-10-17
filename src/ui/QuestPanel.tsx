import { useMemo, useState } from "react";
import type { QuestBook } from "../core/book";
import { QUEST_SHAPES, REWARD_TYPES, rewardSpec, TASK_TYPES, taskSpec } from "../core/registry";
import { getBool, getNumber, getString, setFlag, setNumber, setString, type SnbtCompound } from "../core/snbt";
import { fold } from "../core/text";
import { questIconId } from "./hooks";
import { Field, ItemField, NumberField, TextArea, TextField } from "./inputs";
import { ItemIcon, useShapeOptions } from "./ItemIcon";
import { stripFormatting, useTranslate } from "./McText";
import { TranslatableDescription, TranslatableTextField } from "./TranslatableFields";
import { RawEditor } from "./RawEditor";
import { SubObjectEditor } from "./SubObjectEditor";
import { t } from "../i18n";

/** Quest booleans that FTB only writes when true (most common ones in real packs). */
const QUEST_FLAGS = [
  ["optional", "Optional"],
  ["repeatable", "Repeatable"],
  ["hide_dependency_lines", "Hide dependency lines"],
  ["hide", "Hide until dependencies are complete"],
  ["secret", "Secret"],
] as const;

const MAX_RESULTS = 20;

interface Props {
  book: QuestBook;
  version: number;
  questId: string;
  onSelect(questId: string | null, chapterId?: string): void;
  onError(message: string): void;
}

export function QuestPanel({ book, version, questId, onSelect, onError }: Props) {
  const found = book.quest(questId);
  const [search, setSearch] = useState("");
  const translate = useTranslate();
  const shapes = useShapeOptions(QUEST_SHAPES);

  const needle = fold(search.trim());
  const searching = needle !== "";

  // Labels of every quest in the book. Big packs have thousands, so only build them while searching.
  const allQuests = useMemo(
    () => (searching ? book.chapters.flatMap((c) => book.quests(c).map((q) => ({ id: getString(q, "id")!, label: questLabel(book, q, c.root, translate) }))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, version, searching, translate],
  );

  if (!found) return <div className="panel-empty">{t("Quest not found.")}</div>;
  const { quest, chapter } = found;
  const deps = book.dependencies(quest);
  const labelOf = (id: string) => {
    const dep = book.quest(id);
    if (dep) return questLabel(book, dep.quest, dep.chapter.root, translate);
    const depChapter = book.chapter(id);
    if (depChapter) return `${t("Whole chapter")}: ${stripFormatting(translate(book.getText("chapter", depChapter.root, "title")) || depChapter.path)}`;
    return `${id} (${t("missing")})`;
  };

  const results = needle
    ? allQuests
        .filter((q) => q.id !== questId && !deps.includes(q.id) && (fold(q.label).includes(needle) || q.id.toLowerCase() === needle))
        .slice(0, MAX_RESULTS)
    : [];
  const addDep = (id: string) => {
    try {
      book.addDependency(quest, id);
      setSearch("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">
        <ItemIcon id={questIconId(book, quest)} size={40} fallback="?" />
        <div>
          <h2>{t("Quest")}</h2>
          <div className="mono dim">{questId}</div>
        </div>
      </div>

      <Field label={t("Title")}>
        <TranslatableTextField book={book} kind="quest" obj={quest} field="title" placeholder={t("(the first task's name is used)")} />
      </Field>
      <Field label={t("Subtitle")}>
        <TranslatableTextField book={book} kind="quest" obj={quest} field="subtitle" />
      </Field>
      <Field label={t("Icon")} hint={t("If empty, the first task's item is used.")}>
        <ItemField value={book.itemId(quest, "icon")} iconRef={book.iconRef(quest, "icon")} placeholder={t("(automatic)")} onCommit={(v) => book.setItemId(quest, v, "icon")} />
      </Field>
      <Field label={t("Description")} hint={t("Use the toolbar for colors and styles. A line with only {@pagebreak} starts a new page.")}>
        <TranslatableDescription book={book} kind="quest" obj={quest} />
      </Field>

      <div className="grid-2">
        <Field label={t("Shape")}>
          <select value={getString(quest, "shape") ?? ""} onChange={(e) => book.edit("shape", () => (e.target.value ? setString(quest, "shape", e.target.value) : quest.entries.delete("shape")), quest)}>
            {shapes.map((s) => (
              <option key={s} value={s}>
                {s || t("(chapter default)")}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Size")}>
          <NumberField step={0.25} value={getNumber(quest, "size") ?? 1} onCommit={(v) => book.edit("size", () => setNumber(quest, "size", v, "double"), quest)} />
        </Field>
        <Field label="X">
          <NumberField step={0.5} value={getNumber(quest, "x") ?? 0} onCommit={(v) => book.moveQuest(questId, v, getNumber(quest, "y") ?? 0)} />
        </Field>
        <Field label="Y">
          <NumberField step={0.5} value={getNumber(quest, "y") ?? 0} onCommit={(v) => book.moveQuest(questId, getNumber(quest, "x") ?? 0, v)} />
        </Field>
      </div>

      <div className="flags">
        {QUEST_FLAGS.map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" checked={getBool(quest, key) ?? false} onChange={(e) => book.edit(label, () => setFlag(quest, key, e.target.checked), quest)} />
            {t(label)}
          </label>
        ))}
      </div>

      <h3>{t("Dependencies")}</h3>
      {deps.length === 0 && <p className="hint">{t("None. Add one by dragging from the dot on a quest's right side to another quest on the map.")}</p>}
      <ul className="dep-list">
        {deps.map((d) => {
          const target = book.quest(d);
          return (
            <li key={d}>
              <button className="link-button" disabled={!target} onClick={() => onSelect(d, target?.chapter.id)}>
                {labelOf(d)}
              </button>
              {target && target.chapter !== chapter && <span className="badge dim">{t("other chapter")}</span>}
              {!target && !book.chapter(d) && (
                <span className="badge warn" title={t("This ID isn't in the book; the game ignores this dependency. You can remove it.")}>
                  {t("broken")}
                </span>
              )}
              <button className="icon-button" title={t("Remove")} onClick={() => book.removeDependency(quest, d)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <input value={search} placeholder={t("Add dependency: search quests…")} onChange={(e) => setSearch(e.target.value)} />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((q) => (
            <li key={q.id}>
              <button className="link-button" onClick={() => addDep(q.id)}>
                + {q.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && results.length === 0 && <p className="hint">{t("No matching quests.")}</p>}

      <h3 className="tasks-title">{t("Tasks")}</h3>
      {book.tasks(quest).map((t) => (
        <SubObjectEditor key={getString(t, "id")} book={book} version={version} kind="task" obj={t} spec={taskSpec(getString(t, "type"))} onRemove={() => book.removeTask(quest, t)} />
      ))}
      <AddMenu label={t("+ Add task")} options={TASK_TYPES} onAdd={(type) => book.addTask(quest, type)} />

      <h3 className="rewards-title">{t("Rewards")}</h3>
      {book.rewards(quest).map((r) => (
        <SubObjectEditor key={getString(r, "id")} book={book} version={version} kind="reward" obj={r} spec={rewardSpec(getString(r, "type"))} onRemove={() => book.removeReward(quest, r)} />
      ))}
      <AddMenu label={t("+ Add reward")} options={REWARD_TYPES} onAdd={(type) => book.addReward(quest, type)} />

      <h3>{t("Advanced")}</h3>
      <RawEditor book={book} target={quest} version={version} />
      <button
        className="danger"
        onClick={() => {
          if (window.confirm(t("Delete this quest? (You can undo this)"))) {
            book.deleteQuest(questId);
            onSelect(null);
          }
        }}
      >
        {t("Delete quest")}
      </button>
    </div>
  );
}

/** "Chapter › Quest" without formatting codes; untitled quests fall back to their first task's item. */
function questLabel(book: QuestBook, quest: SnbtCompound, chapterRoot: SnbtCompound, translate: (t: string) => string): string {
  const chapterTitle = translate(book.getText("chapter", chapterRoot, "title")) || getString(chapterRoot, "filename");
  const firstTask = book.tasks(quest)[0];
  const title = translate(book.getText("quest", quest, "title")) || (firstTask && book.itemId(firstTask)) || getString(quest, "id");
  return stripFormatting(`${chapterTitle} › ${title}`);
}

function AddMenu({ label, options, onAdd }: { label: string; options: { type: string; label: string }[]; onAdd(type: string): void }) {
  return (
    <select
      className="add-menu"
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
      }}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.type} value={o.type}>
          {t(o.label)}
        </option>
      ))}
    </select>
  );
}
