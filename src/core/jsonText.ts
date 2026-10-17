// Edits string values of a flat JSON object (a Minecraft lang file) in place, so the
// rest of the file — order, indentation, escapes, comments-free formatting — is untouched.

const STRING = String.raw`"(?:[^"\\]|\\.)*"`;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sets `key` to `value`. An existing entry is replaced where it is; a new one is appended
 * as the last entry with the file's indentation and line endings.
 */
export function setJsonString(text: string, key: string, value: string): string {
  const keyLiteral = escapeRegExp(JSON.stringify(key));
  const existing = new RegExp(`(${keyLiteral}\\s*:\\s*)${STRING}`);
  if (existing.test(text)) return text.replace(existing, (_, prefix: string) => prefix + JSON.stringify(value));

  const close = text.lastIndexOf("}");
  if (close < 0) throw new Error("Invalid lang file");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  const before = text.slice(0, close).replace(/\s*$/, "");
  const isEmpty = before.endsWith("{");
  const entry = `${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  return `${before}${isEmpty ? "" : ","}${eol}${entry}${eol}${text.slice(close)}`;
}
