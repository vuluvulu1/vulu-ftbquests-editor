import { useMemo, useState } from "react";
import type { QuestBook } from "../core/book";
import { QUEST_SHAPES, REWARD_TYPES, rewardSpec, TASK_TYPES, taskSpec } from "../core/registry";
import { getBool, getNumber, getString, setFlag, setNumber, setString, type SnbtCompound } from "../core/snbt";
import { questIconId } from "./hooks";
import { Field, ItemField, NumberField, TextArea, TextField } from "./inputs";
import { ItemIcon, useShapeOptions } from "./ItemIcon";
import { stripFormatting, useTranslate } from "./McText";
import { TranslatableDescription, TranslatableTextField } from "./TranslatableFields";
import { RawEditor } from "./RawEditor";
import { SubObjectEditor } from "./SubObjectEditor";

/** Quest booleans that FTB only writes when true (most common ones in real packs). */
const QUEST_FLAGS = [
  ["optional", "İsteğe bağlı"],
  ["repeatable", "Tekrarlanabilir"],
  ["hide_dependency_lines", "Bağlantı çizgilerini gizle"],
  ["hide", "Bağımlılıklar bitene kadar gizle"],
  ["secret", "Gizli"],
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

  const needle = search.trim().toLocaleLowerCase("tr");
  const searching = needle !== "";

  // Labels of every quest in the book. Big packs have thousands, so only build them while searching.
  const allQuests = useMemo(
    () => (searching ? book.chapters.flatMap((c) => book.quests(c).map((q) => ({ id: getString(q, "id")!, label: questLabel(book, q, c.root, translate) }))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book, version, searching, translate],
  );

  if (!found) return <div className="panel-empty">Görev bulunamadı.</div>;
  const { quest, chapter } = found;
  const deps = book.dependencies(quest);
  const labelOf = (id: string) => {
    const dep = book.quest(id);
    if (dep) return questLabel(book, dep.quest, dep.chapter.root, translate);
    const depChapter = book.chapter(id);
    if (depChapter) return `Bölümün tamamı: ${stripFormatting(translate(book.getText("chapter", depChapter.root, "title")) || depChapter.path)}`;
    return `${id} (mevcut değil)`;
  };

  const results = needle
    ? allQuests
        .filter((q) => q.id !== questId && !deps.includes(q.id) && (q.label.toLocaleLowerCase("tr").includes(needle) || q.id.toLowerCase() === needle))
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
          <h2>Görev</h2>
          <div className="mono dim">{questId}</div>
        </div>
      </div>

      <Field label="Başlık">
        <TranslatableTextField book={book} kind="quest" obj={quest} field="title" placeholder="(ilk şartın adı kullanılır)" />
      </Field>
      <Field label="Alt başlık">
        <TranslatableTextField book={book} kind="quest" obj={quest} field="subtitle" />
      </Field>
      <Field label="Simge" hint="Boşsa ilk şartın eşyası kullanılır.">
        <ItemField value={book.itemId(quest, "icon")} iconRef={book.iconRef(quest, "icon")} placeholder="(otomatik)" onCommit={(v) => book.setItemId(quest, v, "icon")} />
      </Field>
      <Field label="Açıklama" hint="Renk ve biçim için araç çubuğunu kullanın. Tek başına {@pagebreak} yazan satır yeni sayfa başlatır.">
        <TranslatableDescription book={book} kind="quest" obj={quest} />
      </Field>

      <div className="grid-2">
        <Field label="Şekil">
          <select value={getString(quest, "shape") ?? ""} onChange={(e) => book.edit("şekil", () => (e.target.value ? setString(quest, "shape", e.target.value) : quest.entries.delete("shape")), quest)}>
            {shapes.map((s) => (
              <option key={s} value={s}>
                {s || "(bölüm varsayılanı)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Boyut">
          <NumberField step={0.25} value={getNumber(quest, "size") ?? 1} onCommit={(v) => book.edit("boyut", () => setNumber(quest, "size", v, "double"), quest)} />
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
            {label}
          </label>
        ))}
      </div>

      <h3>Bağımlılıklar</h3>
      {deps.length === 0 && <p className="hint">Yok. Haritada bir görevin sağındaki noktadan diğerine sürükleyerek ekleyebilirsiniz.</p>}
      <ul className="dep-list">
        {deps.map((d) => {
          const target = book.quest(d);
          return (
            <li key={d}>
              <button className="link-button" disabled={!target} onClick={() => onSelect(d, target?.chapter.id)}>
                {labelOf(d)}
              </button>
              {target && target.chapter !== chapter && <span className="badge dim">başka bölüm</span>}
              {!target && !book.chapter(d) && (
                <span className="badge warn" title="Bu ID kitapta yok; oyun bu bağımlılığı yok sayar. Silebilirsiniz.">
                  kırık
                </span>
              )}
              <button className="icon-button" title="Kaldır" onClick={() => book.removeDependency(quest, d)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <input value={search} placeholder="Bağımlılık ekle: görev ara…" onChange={(e) => setSearch(e.target.value)} />
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
      {needle && results.length === 0 && <p className="hint">Eşleşen görev yok.</p>}

      <h3 className="tasks-title">Şartlar</h3>
      {book.tasks(quest).map((t) => (
        <SubObjectEditor key={getString(t, "id")} book={book} version={version} kind="task" obj={t} spec={taskSpec(getString(t, "type"))} onRemove={() => book.removeTask(quest, t)} />
      ))}
      <AddMenu label="+ Şart ekle" options={TASK_TYPES} onAdd={(type) => book.addTask(quest, type)} />

      <h3 className="rewards-title">Ödüller</h3>
      {book.rewards(quest).map((r) => (
        <SubObjectEditor key={getString(r, "id")} book={book} version={version} kind="reward" obj={r} spec={rewardSpec(getString(r, "type"))} onRemove={() => book.removeReward(quest, r)} />
      ))}
      <AddMenu label="+ Ödül ekle" options={REWARD_TYPES} onAdd={(type) => book.addReward(quest, type)} />

      <h3>Gelişmiş</h3>
      <RawEditor book={book} target={quest} version={version} />
      <button
        className="danger"
        onClick={() => {
          if (window.confirm("Bu görev silinsin mi? (Geri alınabilir)")) {
            book.deleteQuest(questId);
            onSelect(null);
          }
        }}
      >
        Görevi sil
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
          {o.label}
        </option>
      ))}
    </select>
  );
}
