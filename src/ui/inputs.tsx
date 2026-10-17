import { useEffect, useState, type ReactNode } from "react";
import { ItemIcon, ItemName } from "./ItemIcon";
import { ItemPicker } from "./simple/ItemPicker";
import { t } from "../i18n";

// Inputs that keep a local draft and only commit on blur / Enter, so every
// keystroke does not become a separate undo step.

interface DraftProps<T> {
  value: T;
  onCommit(value: T): void;
  placeholder?: string;
}

export function TextField({ value, onCommit, placeholder, mono }: DraftProps<string> & { mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      className={mono ? "mono" : undefined}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

export function TextArea({ value, onCommit, placeholder, rows = 5, mono }: DraftProps<string> & { rows?: number; mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className={mono ? "mono" : undefined}
      rows={rows}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

interface NumberProps {
  value: number | undefined;
  onCommit(value: number): void;
  step?: number;
  integer?: boolean;
}

export function NumberField({ value, onCommit, step = 1, integer }: NumberProps) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const n = integer ? parseInt(draft, 10) : parseFloat(draft);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setDraft(value === undefined ? "" : String(value));
  };
  return (
    <input
      type="number"
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** Item id input with the item's icon and display name. `iconRef` overrides what is drawn (custom icons). */
export function ItemField({ value, onCommit, placeholder, iconRef }: DraftProps<string> & { iconRef?: string }) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="item-field">
      <button type="button" className="item-field-pick" title={t("Choose from the list")} onClick={() => setPicking(true)}>
        <ItemIcon id={iconRef || value || undefined} size={32} fallback="?" />
      </button>
      <div className="item-field-input">
        <div className="row">
          <TextField mono value={value} placeholder={placeholder ?? t("e.g. minecraft:diamond")} onCommit={(v) => onCommit(v.trim())} />
          <button type="button" onClick={() => setPicking(true)}>
            {t("Choose…")}
          </button>
        </div>
        {value && (
          <span className="hint">
            <ItemName id={value} />
          </span>
        )}
      </div>
      {picking && (
        <ItemPicker
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            onCommit(id);
          }}
        />
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    // Not a <label>: a click inside it would also "click" the first button in it
    // (e.g. a color swatch of the rich text toolbar).
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
