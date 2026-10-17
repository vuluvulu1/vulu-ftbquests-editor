/** FTB Quests shows `{some.key}` as the translation of `some.key` from the game's lang files. */
const TRANSLATION_KEY = /^\{([A-Za-z0-9_.\-:]+)\}$/;

export function translationKey(text: string): string | undefined {
  return TRANSLATION_KEY.exec(text.trim())?.[1];
}

export type Translations = ReadonlyMap<string, string>;

/** Replaces a `{key}` text (or each `{key}` line of a description) with its translation when known. */
export function translateText(text: string, translations: Translations | null): string {
  if (!translations || translations.size === 0 || !text.includes("{")) return text;
  return text
    .split("\n")
    .map((line) => {
      const key = translationKey(line);
      return key ? (translations.get(key) ?? line) : line;
    })
    .join("\n");
}

/** Lowercases for searching so "I", "İ", "ı" and "i" all match (Turkish and English input alike). */
export function fold(text: string): string {
  return text.toLowerCase().split(String.fromCharCode(0x307)).join("").replace(/ı/g, "i");
}
