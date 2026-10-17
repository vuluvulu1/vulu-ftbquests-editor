import type {
  ArrayType,
  NumberType,
  SnbtArray,
  SnbtCompound,
  SnbtDocument,
  SnbtList,
  SnbtNumber,
  SnbtValue,
} from "./types";

export class SnbtParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "SnbtParseError";
  }
}

const UNQUOTED_CHAR = /[0-9A-Za-z_\-.+]/;

const NUMBER_PATTERNS: [RegExp, NumberType][] = [
  [/^[-+]?(?:0|[1-9][0-9]*)b$/i, "byte"],
  [/^[-+]?(?:0|[1-9][0-9]*)s$/i, "short"],
  [/^[-+]?(?:0|[1-9][0-9]*)l$/i, "long"],
  [/^[-+]?(?:0|[1-9][0-9]*)$/, "int"],
  [/^[-+]?(?:[0-9]+\.?|[0-9]*\.[0-9]+)(?:e[-+]?[0-9]+)?f$/i, "float"],
  [/^[-+]?(?:[0-9]+\.?|[0-9]*\.[0-9]+)(?:e[-+]?[0-9]+)?d$/i, "double"],
  [/^[-+]?(?:[0-9]+\.|[0-9]*\.[0-9]+)(?:e[-+]?[0-9]+)?$/i, "double"],
  [/^[-+]?[0-9]+e[-+]?[0-9]+$/i, "double"],
];

/** Parses an unquoted token as a number, or returns undefined if it is not one. */
export function parseNumberToken(token: string): SnbtNumber | undefined {
  for (const [pattern, type] of NUMBER_PATTERNS) {
    if (!pattern.test(token)) continue;
    const digits = /[bslfd]$/i.test(token) ? token.slice(0, -1) : token;
    return { kind: "number", type, value: Number(digits), raw: token };
  }
  return undefined;
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parseRoot(): SnbtValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.pos < this.src.length) this.fail("Unexpected content after root value");
    return value;
  }

  private parseValue(): SnbtValue {
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === "{") return this.parseCompound();
    if (ch === "[") return this.parseListOrArray();
    if (ch === '"' || ch === "'") return { kind: "string", value: this.parseQuoted() };
    if (ch === undefined) this.fail("Unexpected end of input");

    const token = this.readUnquoted();
    if (token === "") this.fail(`Unexpected character '${ch}'`);
    if (token === "true" || token === "false") return { kind: "bool", value: token === "true" };
    return parseNumberToken(token) ?? { kind: "string", value: token, quoted: false };
  }

  private parseCompound(): SnbtCompound {
    const start = this.pos;
    this.expect("{");
    const entries = new Map<string, SnbtValue>();
    while (true) {
      this.skipSeparators();
      if (this.peek() === "}") break;
      const key = this.peek() === '"' || this.peek() === "'" ? this.parseQuoted() : this.readUnquoted();
      if (key === "" && this.peek() !== ":") this.fail("Expected a key");
      this.skipWhitespace();
      this.expect(":");
      if (entries.has(key)) this.fail(`Duplicate key '${key}'`);
      entries.set(key, this.parseValue());
    }
    const inline = !this.src.slice(start, this.pos).includes("\n");
    this.expect("}");
    return { kind: "compound", entries, inline };
  }

  private parseListOrArray(): SnbtList | SnbtArray {
    const start = this.pos;
    this.expect("[");
    const arrayMatch = /^([BIL])\s*;/.exec(this.src.slice(this.pos, this.pos + 8));
    if (arrayMatch) {
      this.pos += arrayMatch[0].length;
      return this.parseArrayBody(({ B: "byte", I: "int", L: "long" } as const)[arrayMatch[1] as "B" | "I" | "L"], start);
    }

    const items: SnbtValue[] = [];
    while (true) {
      this.skipSeparators();
      if (this.peek() === "]") break;
      items.push(this.parseValue());
    }
    const inline = !this.src.slice(start, this.pos).includes("\n");
    this.expect("]");
    return { kind: "list", items, inline };
  }

  private parseArrayBody(type: ArrayType, start: number): SnbtArray {
    const items: SnbtNumber[] = [];
    while (true) {
      this.skipSeparators();
      if (this.peek() === "]") break;
      const token = this.readUnquoted();
      const parsed = parseNumberToken(token);
      if (!parsed) this.fail(`Invalid ${type} array element '${token}'`);
      items.push({ ...parsed, type });
    }
    const inline = !this.src.slice(start, this.pos).includes("\n");
    this.expect("]");
    return { kind: "array", type, items, inline };
  }

  private parseQuoted(): string {
    const quote = this.src[this.pos++]!;
    let out = "";
    while (true) {
      const ch = this.src[this.pos++];
      if (ch === undefined) this.fail("Unterminated string");
      if (ch === quote) return out;
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      const esc = this.src[this.pos++];
      switch (esc) {
        case "\\":
        case '"':
        case "'":
          out += esc;
          break;
        case "n":
          out += "\n";
          break;
        case "t":
          out += "\t";
          break;
        case "r":
          out += "\r";
          break;
        case "u": {
          const hex = this.src.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("Invalid \\u escape");
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
          break;
        }
        default:
          this.fail(`Invalid escape '\\${esc ?? ""}'`);
      }
    }
  }

  private readUnquoted(): string {
    const start = this.pos;
    while (this.pos < this.src.length && UNQUOTED_CHAR.test(this.src[this.pos]!)) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private skipWhitespace() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  /** Elements may be separated by commas, newlines, or both. */
  private skipSeparators() {
    while (this.pos < this.src.length && /[\s,]/.test(this.src[this.pos]!)) this.pos++;
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }

  private expect(ch: string) {
    this.skipWhitespace();
    if (this.src[this.pos] !== ch) this.fail(`Expected '${ch}'`);
    this.pos++;
  }


  private fail(message: string): never {
    const before = this.src.slice(0, this.pos);
    const line = before.split("\n").length;
    const column = this.pos - before.lastIndexOf("\n");
    throw new SnbtParseError(message, line, column);
  }
}

const BOM = 0xfeff;

function stripBom(src: string): string {
  return src.charCodeAt(0) === BOM ? src.slice(1) : src;
}

export function parseSnbt(src: string): SnbtValue {
  return new Parser(stripBom(src)).parseRoot();
}

/** Parses a whole file, also recording its formatting so it can be written back byte for byte. */
export function parseSnbtDocument(src: string): SnbtDocument {
  const body = stripBom(src);
  const indentMatch = /\n([ \t]+)\S/.exec(body);
  const leadingLength = body.length - body.trimStart().length;
  return {
    root: new Parser(body).parseRoot(),
    eol: body.includes("\r\n") ? "\r\n" : "\n",
    indent: indentMatch?.[1] ?? "\t",
    trailingNewline: /\r?\n$/.test(body),
    bom: body !== src,
    // Hand-edited files sometimes have extra blank lines around the root value.
    leading: body.slice(0, leadingLength),
    trailing: body.slice(body.trimEnd().length),
  };
}
