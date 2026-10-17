import { useContext, useEffect, useMemo, useState } from "react";
import { fold } from "../../core/text";
import { AssetsContext, ItemIcon } from "../ItemIcon";
import { Modal } from "./Modal";
import { t } from "../../i18n";

const MAX_RESULTS = 120;

/** Item selection like FTB's: search by name or id, click an icon to pick it. */
interface Props {
  title?: string;
  initial?: string;
  onPick(id: string): void;
  onClose(): void;
  /** Offers an extra button that clears the choice (e.g. back to the automatic quest icon). */
  clearLabel?: string;
  onClear?(): void;
}

export function ItemPicker({ title, initial = "", onPick, onClose, clearLabel, onClear }: Props) {
  const assets = useContext(AssetsContext);
  const [items, setItems] = useState<{ id: string; name: string }[] | null>(null);
  const [query, setQuery] = useState(initial);

  useEffect(() => {
    if (!assets) return;
    let alive = true;
    void assets.allItems().then((list) => alive && setItems(list));
    return () => {
      alive = false;
    };
  }, [assets]);

  const needle = fold(query.trim());
  const results = useMemo(() => {
    if (!items) return [];
    // JEI-style: "@mod" filters by the mod's namespace, other words match name or id.
    const all = needle.split(/\s+/).filter(Boolean);
    const mods = all.filter((w) => w.startsWith("@") && w.length > 1).map((w) => w.slice(1));
    const words = all.filter((w) => !w.startsWith("@"));
    if (!all.length) return items.slice(0, MAX_RESULTS);
    const match = (it: { id: string; name: string }) => {
      const ns = it.id.slice(0, it.id.indexOf(":"));
      if (!mods.every((m) => ns.includes(m))) return false;
      const hay = `${fold(it.name)} ${it.id}`;
      return words.every((w) => hay.includes(w));
    };
    // Best first: exact name/id, then names starting with the query, then vanilla, then the rest.
    const text = words.join(" ");
    const score = (it: { id: string; name: string }) => {
      if (!text) return it.id.startsWith("minecraft:") ? 2 : 3;
      const name = fold(it.name);
      const path = it.id.slice(it.id.indexOf(":") + 1);
      if (name === text || path === text.replace(/ /g, "_") || it.id === text) return 0;
      if (name.startsWith(text) || path.startsWith(text)) return 1;
      if (it.id.startsWith("minecraft:")) return 2;
      return 3;
    };
    return items
      .filter(match)
      .map((it) => ({ it, s: score(it) }))
      .sort((a, b) => a.s - b.s || a.it.name.length - b.it.name.length)
      .slice(0, MAX_RESULTS)
      .map((x) => x.it);
  }, [items, needle]);

  const typedId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(query.trim()) ? query.trim() : undefined;

  return (
    <Modal title={title ?? t("Choose item")} onClose={onClose} width={640}>
      <input autoFocus value={query} placeholder={t("Search: name or ID · @mod to filter by mod (e.g. @sophisticated backpack)")} onChange={(e) => setQuery(e.target.value)} />
      {!assets && <p className="hint">{t("The item list needs the mod files to be loaded. You can type the ID directly.")}</p>}
      {assets && !items && <p className="hint">{t("Listing items…")}</p>}
      <div className="item-grid">
        {results.map((it) => (
          <button key={it.id} className="item-cell" title={`${it.name}\n${it.id}`} onClick={() => onPick(it.id)}>
            <ItemIcon id={it.id} size={32} />
            <span className="item-cell-name">{it.name}</span>
          </button>
        ))}
      </div>
      {items && results.length === MAX_RESULTS && <p className="hint">{t("Showing the first {count} results; narrow your search.", { count: MAX_RESULTS })}</p>}
      {(typedId || onClear) && (
        <div className="row end">
          {onClear && (
            <button className="secondary" onClick={onClear}>
              {clearLabel ?? t("Clear")}
            </button>
          )}
          {typedId && <button onClick={() => onPick(typedId)}>{t("Use \"{id}\"", { id: typedId })}</button>}
        </div>
      )}
    </Modal>
  );
}
