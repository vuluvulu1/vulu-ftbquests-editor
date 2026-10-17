import { useContext, useEffect, useMemo, useState } from "react";
import { AssetsContext, ItemIcon } from "../ItemIcon";
import { Modal } from "./Modal";

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

export function ItemPicker({ title = "Eşya seç", initial = "", onPick, onClose, clearLabel, onClear }: Props) {
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

  const needle = query.trim().toLocaleLowerCase("tr");
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
      const hay = `${it.name.toLocaleLowerCase("tr")} ${it.id}`;
      return words.every((w) => hay.includes(w));
    };
    // Best first: exact name/id, then names starting with the query, then vanilla, then the rest.
    const text = words.join(" ");
    const score = (it: { id: string; name: string }) => {
      if (!text) return it.id.startsWith("minecraft:") ? 2 : 3;
      const name = it.name.toLocaleLowerCase("tr");
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
    <Modal title={title} onClose={onClose} width={640}>
      <input autoFocus value={query} placeholder="Ara: isim veya id · @mod ile moda göre (ör. @sophisticated backpack)" onChange={(e) => setQuery(e.target.value)} />
      {!assets && <p className="hint">Eşya listesi için mod dosyalarının yüklenmesi gerekiyor. ID'yi doğrudan yazabilirsin.</p>}
      {assets && !items && <p className="hint">Eşyalar listeleniyor…</p>}
      <div className="item-grid">
        {results.map((it) => (
          <button key={it.id} className="item-cell" title={`${it.name}\n${it.id}`} onClick={() => onPick(it.id)}>
            <ItemIcon id={it.id} size={32} />
            <span className="item-cell-name">{it.name}</span>
          </button>
        ))}
      </div>
      {items && results.length === MAX_RESULTS && <p className="hint">İlk {MAX_RESULTS} sonuç gösteriliyor; aramayı daraltın.</p>}
      {(typedId || onClear) && (
        <div className="row end">
          {onClear && (
            <button className="secondary" onClick={onClear}>
              {clearLabel ?? "Temizle"}
            </button>
          )}
          {typedId && <button onClick={() => onPick(typedId)}>"{typedId}" kullan</button>}
        </div>
      )}
    </Modal>
  );
}
