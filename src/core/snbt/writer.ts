import { parseNumberToken } from "./parser";
import type { SnbtDocument, SnbtNumber, SnbtValue } from "./types";

export interface WriteOptions {
  indent?: string;
  eol?: "\n" | "\r\n";
  trailingNewline?: boolean;
}

const SAFE_KEY = /^[0-9A-Za-z_\-.+]+$/;
const SUFFIX = { byte: "b", short: "s", int: "", long: "L", float: "f", double: "d" } as const;
const ARRAY_PREFIX = { byte: "B", int: "I", long: "L" } as const;

/** Mirrors Java's Double.toString / Float.toString closely enough for SNBT. */
function javaDecimal(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e7) return `${n}.0`;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e7)) {
    const [mantissa, exp] = n.toExponential().split("e") as [string, string];
    return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}E${Number(exp)}`;
  }
  return String(n);
}

export function formatNumber(n: SnbtNumber): string {
  // Keep the original spelling (e.g. `1d` vs `1.0d`) as long as the value was not edited.
  if (n.raw !== undefined) {
    const reparsed = parseNumberToken(n.raw);
    if (reparsed && reparsed.type === n.type && reparsed.value === n.value) return n.raw;
  }
  const body = n.type === "float" || n.type === "double" ? javaDecimal(n.value) : String(Math.trunc(n.value));
  return body + SUFFIX[n.type];
}

export function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatKey(key: string): string {
  return SAFE_KEY.test(key) ? key : quoteString(key);
}

class Writer {
  constructor(
    private readonly indentUnit: string,
    private readonly eol: string,
  ) {}

  write(value: SnbtValue, depth: number): string {
    switch (value.kind) {
      case "number":
        return formatNumber(value);
      case "bool":
        return String(value.value);
      case "string":
        return value.quoted === false && SAFE_KEY.test(value.value) && !parseNumberToken(value.value)
          ? value.value
          : quoteString(value.value);
      case "array": {
        const prefix = `[${ARRAY_PREFIX[value.type]};`;
        if (value.inline || value.items.length === 0) return `${prefix} ${value.items.map(formatNumber).join(", ")}]`;
        // FTB style: one element per line, no commas.
        const inner = this.indentUnit.repeat(depth + 1);
        return `${prefix}${this.eol}${value.items.map((n) => inner + formatNumber(n)).join(this.eol)}${this.eol}${this.indentUnit.repeat(depth)}]`;
      }
      case "list": {
        if (value.items.length === 0) return "[ ]";
        if (value.inline) return `[${value.items.map((v) => this.write(v, depth)).join(", ")}]`;
        // FTB writes a list holding a single compound as `[{ ... }]`.
        const only = value.items[0]!;
        if (value.items.length === 1 && only.kind === "compound" && !only.inline) {
          return `[${this.write(only, depth)}]`;
        }
        const inner = this.indentUnit.repeat(depth + 1);
        const lines = value.items.map((v) => inner + this.write(v, depth + 1));
        return `[${this.eol}${lines.join(this.eol)}${this.eol}${this.indentUnit.repeat(depth)}]`;
      }
      case "compound": {
        if (value.entries.size === 0) return "{ }";
        const pairs = [...value.entries].map(([k, v]) => `${formatKey(k)}: ${this.write(v, depth + 1)}`);
        if (value.inline) return `{ ${pairs.join(", ")} }`;
        const inner = this.indentUnit.repeat(depth + 1);
        return `{${this.eol}${pairs.map((p) => inner + p).join(this.eol)}${this.eol}${this.indentUnit.repeat(depth)}}`;
      }
    }
  }
}

export function writeSnbt(value: SnbtValue, options: WriteOptions = {}): string {
  const eol = options.eol ?? "\n";
  const out = new Writer(options.indent ?? "\t", eol).write(value, 0);
  return options.trailingNewline === false ? out : out + eol;
}

export function writeSnbtDocument(doc: SnbtDocument): string {
  const body = writeSnbt(doc.root, { ...doc, trailingNewline: false });
  const trailing = doc.trailing ?? (doc.trailingNewline ? doc.eol : "");
  return (doc.bom ? String.fromCharCode(0xfeff) : "") + (doc.leading ?? "") + body + trailing;
}
