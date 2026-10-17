import { useSyncExternalStore } from "react";
import { tr } from "./locales/tr";

// UI translation. English text is the key: `t("Save")` shows "Save", or the Turkish
// entry when Turkish is chosen (falling back to English for anything missing).
// `{name}` placeholders are filled from `vars`.

export type Lang = "en" | "tr";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "tr", label: "Türkçe" },
];

const DICTS: Record<Lang, Record<string, string> | null> = { en: null, tr };
const KEY = "ftbqe.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    // no storage (tests, private window): fall through to the system language
  }
  const system = typeof navigator !== "undefined" ? navigator.language?.toLowerCase() : "";
  return system?.startsWith("tr") ? "tr" : "en";
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // not persisted; the system language is used next time
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const s = DICTS[current]?.[text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Re-renders the caller when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    lang,
  );
}

if (typeof document !== "undefined") document.documentElement.lang = current;
