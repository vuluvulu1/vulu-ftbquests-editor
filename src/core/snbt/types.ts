/**
 * SNBT value tree. Numeric types are tracked explicitly because FTB Quests
 * (and Minecraft) care about the difference between e.g. `16`, `16L` and `16.0d`.
 */

export type NumberType = "byte" | "short" | "int" | "long" | "float" | "double";
export type ArrayType = "byte" | "int" | "long";

export interface SnbtNumber {
  kind: "number";
  type: NumberType;
  value: number;
  /** Original text from the file; reused on write while `value` is unchanged. */
  raw?: string;
}

export interface SnbtString {
  kind: "string";
  value: string;
  /** False when the file used an unquoted token like `item`. */
  quoted?: boolean;
}

export interface SnbtBool {
  kind: "bool";
  value: boolean;
}

export interface SnbtList {
  kind: "list";
  items: SnbtValue[];
  /** Written on a single line (as found in the source file). */
  inline?: boolean;
}

export interface SnbtArray {
  kind: "array";
  type: ArrayType;
  items: SnbtNumber[];
  /** Written on a single line. FTB itself writes one element per line. */
  inline?: boolean;
}

export interface SnbtCompound {
  kind: "compound";
  /** Map keeps insertion order, which is preserved on write. */
  entries: Map<string, SnbtValue>;
  inline?: boolean;
}

export type SnbtValue = SnbtNumber | SnbtString | SnbtBool | SnbtList | SnbtArray | SnbtCompound;

export interface SnbtDocument {
  root: SnbtValue;
  /** Line ending detected in the source file. */
  eol: "\n" | "\r\n";
  /** Indent unit detected in the source file. */
  indent: string;
  trailingNewline: boolean;
  /** File started with a UTF-8 byte order mark. */
  bom?: boolean;
  /** Exact whitespace before / after the root value; when set it replaces `trailingNewline`. */
  leading?: string;
  trailing?: string;
}

// ---- Factories -------------------------------------------------------------

export const num = (type: NumberType, value: number): SnbtNumber => ({ kind: "number", type, value });
export const int = (value: number) => num("int", value);
export const long = (value: number) => num("long", value);
export const double = (value: number) => num("double", value);
export const str = (value: string): SnbtString => ({ kind: "string", value });
export const bool = (value: boolean): SnbtBool => ({ kind: "bool", value });
export const list = (items: SnbtValue[] = [], inline?: boolean): SnbtList => ({ kind: "list", items, inline });

export function compound(entries: Record<string, SnbtValue> | Map<string, SnbtValue> = {}): SnbtCompound {
  return {
    kind: "compound",
    entries: entries instanceof Map ? entries : new Map(Object.entries(entries)),
  };
}
