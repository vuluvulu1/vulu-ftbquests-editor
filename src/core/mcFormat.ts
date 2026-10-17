// Minecraft text formatting (`&a` colors, `&l` bold…) as styled runs, both ways, so a
// visual editor can show formatted text and write the codes back. Each line is separate:
// FTB Quests renders every description line on its own, so styles never carry over.

export const MC_COLORS: { code: string; hex: string; name: string }[] = [
  { code: "0", hex: "#000000", name: "Siyah" },
  { code: "1", hex: "#0000aa", name: "Koyu mavi" },
  { code: "2", hex: "#00aa00", name: "Koyu yeşil" },
  { code: "3", hex: "#00aaaa", name: "Koyu turkuaz" },
  { code: "4", hex: "#aa0000", name: "Koyu kırmızı" },
  { code: "5", hex: "#aa00aa", name: "Mor" },
  { code: "6", hex: "#ffaa00", name: "Altın" },
  { code: "7", hex: "#aaaaaa", name: "Gri" },
  { code: "8", hex: "#555555", name: "Koyu gri" },
  { code: "9", hex: "#5555ff", name: "Mavi" },
  { code: "a", hex: "#55ff55", name: "Yeşil" },
  { code: "b", hex: "#55ffff", name: "Turkuaz" },
  { code: "c", hex: "#ff5555", name: "Kırmızı" },
  { code: "d", hex: "#ff55ff", name: "Pembe" },
  { code: "e", hex: "#ffff55", name: "Sarı" },
  { code: "f", hex: "#ffffff", name: "Beyaz" },
];

export const FLAGS = ["bold", "italic", "underline", "strike", "obfuscated"] as const;
export type Flag = (typeof FLAGS)[number];
const FLAG_CODE: Record<Flag, string> = { bold: "l", italic: "o", underline: "n", strike: "m", obfuscated: "k" };
const CODE_FLAG: Record<string, Flag> = { l: "bold", o: "italic", n: "underline", m: "strike", k: "obfuscated" };

export type RunStyle = { color?: string } & Partial<Record<Flag, boolean>>;
/**
 * `reset`: the run starts with an explicit `&r`. Kept even where Minecraft would not need it,
 * because text effect mods use `&r` to end tags like `<grad …>`.
 */
export type Run = RunStyle & { text: string; reset?: boolean };

const CODE = /\\&|[&§]([0-9a-fk-or])/gi;

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return (a.color ?? "") === (b.color ?? "") && FLAGS.every((f) => !!a[f] === !!b[f]);
}

/** Splits one line into runs of equal style (adjacent equal runs are merged). */
export function parseLine(line: string): Run[] {
  const runs: Run[] = [];
  let style: RunStyle = {};
  let pendingReset = false;
  let last = 0;
  const add = (text: string) => {
    if (!text) return;
    const prev = runs.at(-1);
    if (pendingReset) runs.push({ ...style, text, reset: true });
    else if (prev && sameStyle(prev, style)) prev.text += text;
    else runs.push({ ...style, text });
    pendingReset = false;
  };
  for (const m of line.matchAll(CODE)) {
    add(line.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0] === "\\&") {
      add("&");
      continue;
    }
    const code = m[1]!.toLowerCase();
    if (/[0-9a-f]/.test(code)) style = { color: code }; // a color resets formatting, as in Minecraft
    else if (code === "r") {
      style = {};
      pendingReset = true;
    } else style = { ...style, [CODE_FLAG[code]!]: true };
  }
  add(line.slice(last));
  return runs;
}

export function parseLines(text: string): Run[][] {
  return text.split("\n").map(parseLine);
}

/** `&` that would read as a code is escaped as `\&`. */
function escapeText(text: string): string {
  return text.replace(/&(?=[0-9a-fk-or])/gi, "\\&");
}

/** Writes runs back with as few codes as possible. */
export function serializeLine(runs: Run[]): string {
  let out = "";
  let cur: RunStyle = {};
  for (const run of runs) {
    if (!run.text) continue;
    if (run.reset) {
      out += "&r";
      cur = {};
    }
    if (!sameStyle(cur, run)) {
      const lostSomething = (!!cur.color && cur.color !== run.color) || FLAGS.some((f) => cur[f] && !run[f]);
      if (run.color && (run.color !== cur.color || lostSomething)) {
        out += `&${run.color}`;
        cur = { color: run.color };
      } else if (lostSomething) {
        out += "&r";
        cur = {};
      }
      for (const f of FLAGS) {
        if (run[f] && !cur[f]) {
          out += `&${FLAG_CODE[f]}`;
          cur = { ...cur, [f]: true };
        }
      }
    }
    out += escapeText(run.text);
  }
  return out;
}

export function serializeLines(lines: Run[][]): string {
  return lines.map(serializeLine).join("\n");
}

export function colorHex(code: string | undefined): string | undefined {
  return MC_COLORS.find((c) => c.code === code)?.hex;
}

/** Palette code for a CSS color like `rgb(85, 255, 85)` or `#55ff55`; undefined if not a palette color. */
export function colorCode(css: string): string | undefined {
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  const hex = rgb
    ? `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`
    : /^#[0-9a-f]{6}$/i.test(css.trim())
      ? css.trim().toLowerCase()
      : undefined;
  return MC_COLORS.find((c) => c.hex === hex)?.code;
}
