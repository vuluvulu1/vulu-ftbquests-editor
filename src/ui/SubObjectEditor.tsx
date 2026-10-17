import type { QuestBook } from "../core/book";
import type { TypeSpec } from "../core/registry";
import { getBool, getLong, getNumber, getString, setFlag, setLong, setNumber, setString, type SnbtCompound } from "../core/snbt";
import { Field, ItemField, NumberField, TextField } from "./inputs";
import { stripFormatting, useTranslate } from "./McText";
import { TranslatableTextField } from "./TranslatableFields";
import { RawEditor } from "./RawEditor";

interface Props {
  book: QuestBook;
  version: number;
  kind: "task" | "reward";
  obj: SnbtCompound;
  spec: TypeSpec | undefined;
  onRemove(): void;
  /** Simple mode: no raw SNBT editor. */
  simple?: boolean;
}

/** Card for one task or reward: a form for known types, raw SNBT for everything. */
export function SubObjectEditor({ book, version, kind, obj, spec, onRemove, simple }: Props) {
  const type = getString(obj, "type") ?? "?";
  const translate = useTranslate();
  return (
    <div className="card">
      <div className="card-header">
        <span className="badge">{spec?.label ?? type}</span>
        <span className="mono dim">{getString(obj, "id")}</span>
        <button className="icon-button" title="Sil" onClick={onRemove}>
          ✕
        </button>
      </div>
      <Field label="Başlık (isteğe bağlı)">
        <TranslatableTextField book={book} kind={kind} obj={obj} field="title" />
      </Field>
      {spec?.fields.map((f) => {
        switch (f.kind) {
          case "item":
            return (
              <Field key={f.key} label={f.label}>
                <ItemField value={book.itemId(obj, f.key)} onCommit={(v) => book.setItemId(obj, v, f.key)} />
              </Field>
            );
          case "string":
            return (
              <Field key={f.key} label={f.label}>
                <TextField
                  mono
                  value={getString(obj, f.key) ?? ""}
                  onCommit={(v) => book.edit(f.label, () => setString(obj, f.key, v), obj)}
                />
              </Field>
            );
          case "int":
          case "long":
            return (
              <Field key={f.key} label={f.label}>
                <NumberField
                  integer
                  value={getNumber(obj, f.key) ?? 1}
                  onCommit={(v) => book.edit(f.label, () => setNumber(obj, f.key, v, f.kind as "int" | "long"), obj)}
                />
              </Field>
            );
          case "table": {
            const current = getLong(obj, f.key)?.toString() ?? "";
            const tables = book.rewardTables;
            return (
              <Field key={f.key} label={f.label}>
                <select value={current} onChange={(e) => book.edit(f.label, () => setLong(obj, f.key, BigInt(e.target.value)), obj)}>
                  {!tables.some((t) => t.longId.toString() === current) && <option value={current}>(bulunamadı: {current || "yok"})</option>}
                  {tables.map((t) => (
                    <option key={t.path} value={t.longId.toString()}>
                      {stripFormatting(translate(book.getText("reward_table", t.root, "title"))) || t.path.replace(/^reward_tables\/|\.snbt$/g, "")}
                    </option>
                  ))}
                </select>
              </Field>
            );
          }
          case "bool":
            return (
              <label key={f.key} className="check">
                <input
                  type="checkbox"
                  checked={getBool(obj, f.key) ?? false}
                  onChange={(e) => book.edit(f.label, () => setFlag(obj, f.key, e.target.checked), obj)}
                />
                {f.label}
              </label>
            );
        }
      })}
      {!spec && <p className="hint">Bu tür için form yok; alanları ham SNBT ile düzenleyebilirsiniz.</p>}
      {/* In simple mode the raw editor is only offered for types without a form. */}
      {(!simple || !spec) && <RawEditor book={book} target={obj} version={version} />}
    </div>
  );
}
