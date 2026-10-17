import { useState, type MouseEvent } from "react";
import type { QuestBook } from "../../core/book";
import { REWARD_TYPES, rewardSpec, TASK_TYPES, taskSpec, taskTypeIcon } from "../../core/registry";
import { getBool, getNumber, getString, setFlag, type SnbtCompound } from "../../core/snbt";
import { questIconId } from "../hooks";
import { ItemIcon, ItemName } from "../ItemIcon";
import { McText, stripFormatting, useTranslate } from "../McText";
import { SubObjectEditor } from "../SubObjectEditor";
import { TranslatableDescription, TranslatableTextField } from "../TranslatableFields";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { ItemPicker } from "./ItemPicker";
import { Modal } from "./Modal";
import { QuestPicker } from "./QuestPicker";

// The quest window as FTB Quests shows it in game: icon + title, subtitle, tasks on the left
// (blue), rewards on the right (orange), description below; "+" buttons add tasks / rewards.

/** The few switches worth having at hand; everything else is under "Diğer ayarlar". */
const QUICK_FLAGS = [
  ["optional", "İsteğe bağlı", "Bölümün ilerlemesi için gerekmez"],
  ["repeatable", "Tekrarlanabilir", "Tamamlandıktan sonra tekrar yapılabilir"],
] as const;

const REWARD_ICONS: Record<string, string> = {
  xp: "minecraft:experience_bottle",
  xp_levels: "minecraft:experience_bottle",
  command: "minecraft:command_block",
  loot: "ftbquests:lootcrate",
  random: "texture:ftblibrary:textures/icons/dice.png",
  choice: "texture:ftblibrary:textures/icons/money_bag.png",
};

interface Props {
  book: QuestBook;
  version: number;
  questId: string;
  onClose(): void;
  onOpenSettings(): void;
  onError(message: string): void;
}

type Kind = "task" | "reward";

export function QuestView({ book, version, questId, onClose, onOpenSettings, onError }: Props) {
  const menu = useContextMenu();
  const translate = useTranslate();
  const [editing, setEditing] = useState<{ kind: Kind; obj: SnbtCompound } | null>(null);
  const [picker, setPicker] = useState<((id: string) => void) | null>(null);
  const [iconPicker, setIconPicker] = useState(false);
  const [depPicker, setDepPicker] = useState(false);
  const found = book.quest(questId);
  if (!found) return null;
  const { quest } = found;
  const deps = book.dependencies(quest);
  const questName = (q: SnbtCompound) => {
    const first = book.tasks(q)[0];
    const name = stripFormatting(translate(book.getText("quest", q, "title"))) || (first && book.itemId(first)) || getString(q, "id")!;
    return name.length > 28 ? `${name.slice(0, 27)}…` : name;
  };

  const add = (kind: Kind, type: string) => {
    const create = (itemId?: string) => {
      const obj = book.edit(
        kind === "task" ? "şart ekle" : "ödül ekle",
        () => {
          const o = kind === "task" ? book.addTask(quest, type) : book.addReward(quest, type);
          if (itemId) book.setItemId(o, itemId);
          return o;
        },
        quest,
      );
      // Types with settings beyond the item open right away, like FTB's creation screen.
      const spec = kind === "task" ? taskSpec(type) : rewardSpec(type);
      if (!itemId || (spec?.fields.length ?? 0) > 1) setEditing({ kind, obj });
    };
    const spec = kind === "task" ? taskSpec(type) : rewardSpec(type);
    if (spec?.hasItem) setPicker(() => (id: string) => create(id));
    else create();
  };

  const addMenu = (kind: Kind) => (e: MouseEvent) => {
    const types = kind === "task" ? TASK_TYPES : REWARD_TYPES;
    menu(
      e.clientX,
      e.clientY,
      types.map((t) => ({
        label: t.label,
        icon: kind === "task" ? (t.type === "item" ? "minecraft:chest" : taskTypeIcon(t.type)) : t.type === "item" ? "minecraft:chest" : REWARD_ICONS[t.type],
        onClick: () => add(kind, t.type),
      })),
    );
  };

  const objMenu = (kind: Kind, obj: SnbtCompound) => (e: MouseEvent) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: "Düzenle", onClick: () => setEditing({ kind, obj }) },
      {
        label: "Sil",
        danger: true,
        onClick: () => (kind === "task" ? book.removeTask(quest, obj) : book.removeReward(quest, obj)),
      },
    ];
    menu(e.clientX, e.clientY, items);
  };

  const box = (kind: Kind, obj: SnbtCompound) => {
    const type = getString(obj, "type");
    const item = book.iconRef(obj, "icon") || book.iconRef(obj);
    const icon = item || (kind === "task" ? taskTypeIcon(type) : REWARD_ICONS[type ?? ""]);
    const count = getNumber(obj, "count");
    const title = book.getText(kind, obj, "title");
    return (
      <button
        key={getString(obj, "id")}
        className="quest-view-slot"
        onClick={() => setEditing({ kind, obj })}
        onContextMenu={objMenu(kind, obj)}
        title="Tıkla: düzenle · Sağ tık: menü"
      >
        <ItemIcon id={icon} size={32} fallback={type ?? "?"} />
        {count !== undefined && count > 1 && <span className="slot-count">{count}</span>}
        <span className="slot-tooltip mc-tooltip">
          {title ? <McText text={title} /> : book.itemId(obj) ? <ItemName id={book.itemId(obj)} /> : (kind === "task" ? taskSpec(type) : rewardSpec(type))?.label ?? type}
        </span>
      </button>
    );
  };

  return (
    <Modal onClose={onClose} width={620} className="quest-view">
      <div className="quest-view-head">
        <button className="quest-view-icon" title="Görev simgesini değiştir" onClick={() => setIconPicker(true)}>
          <ItemIcon id={questIconId(book, quest)} size={36} fallback="?" />
        </button>
        <div className="quest-view-title">
          <TranslatableTextField book={book} kind="quest" obj={quest} field="title" placeholder="Başlık (boşsa ilk şartın adı)" />
        </div>
        <button className="icon-button" title="Görev ayarları (şekil, boyut, görünürlük, bağımlılıklar…)" onClick={onOpenSettings}>
          ⚙
        </button>
        <button className="icon-button" title="Kapat (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="quest-view-subtitle">
        <TranslatableTextField book={book} kind="quest" obj={quest} field="subtitle" placeholder="Alt başlık" />
      </div>

      <div className="quest-view-columns">
        <section>
          <h3 className="tasks-title">Şartlar</h3>
          <div className="quest-view-slots">
            {book.tasks(quest).map((t) => box("task", t))}
            <button className="quest-view-slot add" title="Şart ekle" onClick={addMenu("task")}>
              +
            </button>
          </div>
        </section>
        <section>
          <h3 className="rewards-title">Ödüller</h3>
          <div className="quest-view-slots">
            {book.rewards(quest).map((r) => box("reward", r))}
            <button className="quest-view-slot add" title="Ödül ekle" onClick={addMenu("reward")}>
              +
            </button>
          </div>
        </section>
      </div>

      <div className="quest-view-deps">
        <span className="quest-view-label" title="Bu görev, bunlar tamamlanınca açılır">
          Gereksinimler
        </span>
        {deps.map((d) => {
          const dep = book.quest(d);
          const depChapter = !dep ? book.chapter(d) : undefined;
          const name = dep ? questName(dep.quest) : depChapter ? `Bölüm: ${stripFormatting(translate(book.getText("chapter", depChapter.root, "title")))}` : d;
          return (
            <span key={d} className={`dep-chip ${dep || depChapter ? "" : "broken"}`} title={dep || depChapter ? name : "Bu görev kitapta yok"}>
              {dep && <ItemIcon id={questIconId(book, dep.quest)} size={16} fallback="" />}
              <span className="dep-chip-name">{name}</span>
              <button className="dep-chip-remove" title="Kaldır" onClick={() => book.removeDependency(quest, d)}>
                ×
              </button>
            </span>
          );
        })}
        <button className="dep-chip add" title="Gereksinim ekle" onClick={() => setDepPicker(true)}>
          +
        </button>
      </div>

      <div className="quest-view-description">
        <TranslatableDescription book={book} kind="quest" obj={quest} />
      </div>

      <div className="quest-view-flags">
        {QUICK_FLAGS.map(([key, label, hint]) => (
          <button
            key={key}
            className={`flag-chip ${getBool(quest, key) ? "on" : ""}`}
            title={hint}
            onClick={() => book.edit(label, () => setFlag(quest, key, !getBool(quest, key)), quest)}
          >
            {getBool(quest, key) ? "✓ " : ""}
            {label}
          </button>
        ))}
        <span className="spacer" />
        <button className="link-button" onClick={onOpenSettings}>
          Diğer ayarlar…
        </button>
      </div>

      {iconPicker && (
        <ItemPicker
          title="Görev simgesi"
          clearLabel="Otomatik (ilk şartın eşyası)"
          onClear={() => {
            setIconPicker(false);
            book.setItemId(quest, "", "icon");
          }}
          onClose={() => setIconPicker(false)}
          onPick={(id) => {
            setIconPicker(false);
            book.setItemId(quest, id, "icon");
          }}
        />
      )}
      {depPicker && (
        <QuestPicker
          book={book}
          title="Gereksinim ekle"
          exclude={[questId, ...deps]}
          onClose={() => setDepPicker(false)}
          onPick={(id) => {
            setDepPicker(false);
            try {
              book.addDependency(quest, id);
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}

      {editing && (
        <Modal title={editing.kind === "task" ? "Şart" : "Ödül"} onClose={() => setEditing(null)} width={460}>
          <SubObjectEditor
            simple
            book={book}
            version={version}
            kind={editing.kind}
            obj={editing.obj}
            spec={editing.kind === "task" ? taskSpec(getString(editing.obj, "type")) : rewardSpec(getString(editing.obj, "type"))}
            onRemove={() => {
              if (editing.kind === "task") book.removeTask(quest, editing.obj);
              else book.removeReward(quest, editing.obj);
              setEditing(null);
            }}
          />
        </Modal>
      )}
      {picker && (
        <ItemPicker
          onClose={() => setPicker(null)}
          onPick={(id) => {
            const done = picker;
            setPicker(null);
            try {
              done(id);
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </Modal>
  );
}
