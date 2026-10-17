import { createContext, useCallback, useContext, type CSSProperties } from "react";
import { translateText, translationKey, type Translations } from "../core/text";
import { t } from "../i18n";

/** Translations of `{key}` texts loaded from the instance's lang files (null until loaded). */
export const TranslationsContext = createContext<Translations | null>(null);

/** Returns a function that turns `{key}` texts into their translation. */
export function useTranslate(): (text: string) => string {
  const translations = useContext(TranslationsContext);
  return useCallback((text: string) => translateText(text, translations), [translations]);
}

/** Under an edit field: what a `{key}` text actually shows in game. */
export function TranslationHint({ text }: { text: string }) {
  const translate = useTranslate();
  if (!text.split("\n").some((l) => translationKey(l))) return null;
  const shown = translate(text);
  return (
    <span className="hint translation">
      {shown === text ? t("Translation key (not found in the lang files)") : <>{t("In game")}: <McText text={shown} /></>}
    </span>
  );
}

// Minecraft formatting codes as used in FTB Quests texts: `&a` green, `&l` bold, `&r` reset…
// `\&` is a literal ampersand.

const COLORS: Record<string, string> = {
  "0": "#000000",
  "1": "#0000aa",
  "2": "#00aa00",
  "3": "#00aaaa",
  "4": "#aa0000",
  "5": "#aa00aa",
  "6": "#ffaa00",
  "7": "#aaaaaa",
  "8": "#555555",
  "9": "#5555ff",
  a: "#55ff55",
  b: "#55ffff",
  c: "#ff5555",
  d: "#ff55ff",
  e: "#ffff55",
  f: "#ffffff",
};

/**
 * `&` color codes, `\&`, and text-animation tags like `<grad from=#F5B3FF to=#A21CAF>`,
 * `<rainb>` or `<shake>` (used by packs with a text effects mod; they have no closing tag
 * and last until the end of the text or the next style change).
 */
const CODE = /\\&|[&§]([0-9a-fk-or])|<(\/?)([a-z]+)((?:\s[^<>]*)?)>/gi;
const ANIMATION_TAGS = new Set(["grad", "rainb", "rainbow", "neon", "shake", "wave", "pend", "glitch", "swing", "bounce", "fade", "type", "jitter", "wiggle"]);
const RAINBOW = "linear-gradient(90deg, #ff5555, #ffaa00, #ffff55, #55ff55, #55ffff, #5555ff, #ff55ff)";

const isTag = (m: RegExpMatchArray) => m[3] !== undefined;

/** Plain text without formatting codes or effect tags, for places that cannot show colors (e.g. <option>). */
export function stripFormatting(text: string): string {
  return text.replace(CODE, (...args) => {
    const [m, , , tag] = args as [string, string?, string?, string?];
    if (m === "\\&") return "&";
    if (tag !== undefined) return ANIMATION_TAGS.has(tag.toLowerCase()) ? "" : m;
    return "";
  });
}

interface Span {
  text: string;
  style: CSSProperties;
}

function gradientText(image: string): CSSProperties {
  // A text-shadow would be painted over the clipped gradient and darken it.
  return { backgroundImage: image, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textShadow: "none" };
}

function attribute(params: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=(#[0-9a-f]{3,8})`, "i").exec(params)?.[1];
}

function parse(text: string): Span[] {
  const spans: Span[] = [];
  let style: CSSProperties = {};
  let last = 0;
  const push = (end: number) => {
    if (end > last) spans.push({ text: text.slice(last, end), style });
  };
  for (const m of text.matchAll(CODE)) {
    if (isTag(m)) {
      const [, , closing, rawName, params = ""] = m;
      const name = rawName!.toLowerCase();
      if (!ANIMATION_TAGS.has(name)) continue; // ordinary "<text>": keep as is
      push(m.index);
      last = m.index + m[0].length;
      const { backgroundImage, WebkitBackgroundClip, backgroundClip, textShadow, ...rest } = style;
      if (closing) style = rest;
      else if (name === "grad") {
        const from = attribute(params, "from");
        const to = attribute(params, "to") ?? from;
        if (from) style = { ...rest, ...gradientText(`linear-gradient(90deg, ${from}, ${to})`) };
      } else if (name === "rainb" || name === "rainbow") style = { ...rest, ...gradientText(RAINBOW) };
      else if (name === "neon") style = { ...style, textShadow: "0 0 6px currentColor" };
      // motion effects (shake, wave…) cannot be shown in a static editor: just drop the tag
      continue;
    }
    if (m[0] === "\\&") {
      push(m.index);
      spans.push({ text: "&", style });
      last = m.index + 2;
      continue;
    }
    push(m.index);
    last = m.index + m[0].length;
    const code = m[1]!.toLowerCase();
    if (COLORS[code]) style = { color: COLORS[code] }; // a color resets other formatting, as in Minecraft
    else if (code === "r") style = {};
    else if (code === "l") style = { ...style, fontWeight: "bold" };
    else if (code === "o") style = { ...style, fontStyle: "italic" };
    else if (code === "n") style = { ...style, textDecoration: "underline" };
    else if (code === "m") style = { ...style, textDecoration: "line-through" };
  }
  push(text.length);
  return spans;
}

/** Renders a text with its Minecraft colors. White (&f) uses the normal text color for readability. */
export function McText({ text }: { text: string }) {
  const translate = useTranslate();
  // FTB renders each line on its own, so formatting does not carry over to the next line.
  return (
    <>
      {translate(text)
        .split("\n")
        .map((line, l) => (
          <span key={l}>
            {l > 0 && "\n"}
            {parse(line).map((s, i) => (
              <span key={i} style={s.style.color === "#ffffff" ? { ...s.style, color: undefined } : s.style}>
                {s.text}
              </span>
            ))}
          </span>
        ))}
    </>
  );
}
