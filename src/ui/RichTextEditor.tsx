import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { colorCode, colorHex, MC_COLORS, parseLines, serializeLines, type Run, type RunStyle } from "../core/mcFormat";

// WYSIWYG editor for Minecraft-formatted text: the text is shown with its colors and the
// `&` codes are generated from the formatting. The DOM is only rebuilt from `value` when the
// value changes from outside; while typing the browser owns it, and the codes are read
// back from it on blur.

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function runHtml(run: Run): string {
  const css: string[] = [];
  const hex = colorHex(run.color);
  if (hex) css.push(`color:${hex}`);
  if (run.bold) css.push("font-weight:bold");
  if (run.italic) css.push("font-style:italic");
  const deco = [run.underline && "underline", run.strike && "line-through"].filter(Boolean).join(" ");
  if (deco) css.push(`text-decoration:${deco}`);
  const attrs = (run.obfuscated ? ' class="obf"' : "") + (run.reset ? ' data-reset="1"' : "");
  return css.length || attrs ? `<span${attrs} style="${css.join(";")}">${escapeHtml(run.text)}</span>` : escapeHtml(run.text);
}

/** One `<div>` per line; an empty line holds a `<br>` so it stays editable. */
export function linesHtml(text: string): string {
  return parseLines(text)
    .map((runs) => `<div>${runs.length ? runs.map(runHtml).join("") : "<br>"}</div>`)
    .join("");
}

/** Style of a text node from its ancestors (nearest explicit value wins; decorations add up). */
function styleOf(node: Node, root: HTMLElement): RunStyle {
  const style: RunStyle & { reset?: boolean } = {};
  // An explicit &r is kept on the first text of the span that carries it.
  const parent = node.parentElement;
  if (parent?.dataset.reset && parent.firstChild === node) style.reset = true;
  let colorSet = false;
  let weightSet = false;
  let italicSet = false;
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    const tag = el.tagName;
    if (!colorSet && (el.style.color || el.getAttribute("color"))) {
      style.color = colorCode(el.style.color || el.getAttribute("color")!);
      colorSet = true;
    }
    if (!weightSet && (el.style.fontWeight || tag === "B" || tag === "STRONG")) {
      const w = el.style.fontWeight;
      style.bold = w ? w === "bold" || Number(w) >= 600 : true;
      weightSet = true;
    }
    if (!italicSet && (el.style.fontStyle || tag === "I" || tag === "EM")) {
      style.italic = el.style.fontStyle ? el.style.fontStyle === "italic" : true;
      italicSet = true;
    }
    const deco = el.style.textDecorationLine || el.style.textDecoration;
    if (tag === "U" || deco.includes("underline")) style.underline = true;
    if (tag === "S" || tag === "STRIKE" || deco.includes("line-through")) style.strike = true;
    if (el.classList.contains("obf")) style.obfuscated = true;
  }
  return style;
}

/** Reads the formatted lines back from the editor's DOM. */
export function readLines(root: HTMLElement): Run[][] {
  const lines: Run[][] = [[]];
  let started = false;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/ /g, " ") ?? "";
      if (text) lines.at(-1)!.push({ ...styleOf(node, root), text });
      started = true;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      // The placeholder <br> closing a block does not start another line.
      const isPlaceholder = !node.nextSibling && node.parentElement !== root && node.parentElement?.tagName !== "SPAN";
      if (!isPlaceholder) lines.push([]);
      started = true;
      return;
    }
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && started) lines.push([]);
    node.childNodes.forEach(walk);
    if (block) started = true;
  };
  root.childNodes.forEach(walk);
  return lines;
}

interface Props {
  value: string;
  onCommit(value: string): void;
  multiline?: boolean;
  placeholder?: string;
}

export function RichTextEditor({ value, onCommit, multiline, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  /** The value the DOM currently represents. */
  const shown = useRef<string | null>(null);
  /** Set by typing or formatting; without it a blur never writes (codes stay exactly as they were). */
  const edited = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown.current === value) return;
    el.innerHTML = value ? linesHtml(value) : "";
    shown.current = value;
    edited.current = false;
  }, [value]);

  const read = () => {
    const lines = readLines(ref.current!);
    const text = serializeLines(multiline ? lines : [lines.flat()]);
    return multiline ? text.replace(/\n+$/, "") : text;
  };

  const commit = () => {
    if (!edited.current) return;
    edited.current = false;
    const text = read();
    shown.current = text;
    if (text !== value) onCommit(text);
  };

  const exec = (command: string, arg?: string) => {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, arg);
    ref.current?.focus();
  };

  // Keep the selection in the editor when clicking toolbar buttons.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      ref.current?.blur();
    }
    if (e.key === "Escape") {
      ref.current!.innerHTML = value ? linesHtml(value) : "";
      shown.current = value;
      edited.current = false;
      ref.current?.blur();
    }
  };

  /** Pasted text with `&` codes comes in formatted; anything else as plain text. */
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain").replace(/\r\n/g, "\n");
    if (!multiline) text = text.replace(/\n/g, " ");
    const html = parseLines(text)
      .map((runs) => runs.map(runHtml).join(""))
      .join("<br>");
    document.execCommand("insertHTML", false, html);
  };

  const defaultColor = () => (ref.current ? getComputedStyle(ref.current).color : "");

  return (
    <div className={`rich-text ${multiline ? "multiline" : ""}`}>
      <div className="rich-toolbar" onMouseDown={keepFocus}>
        {MC_COLORS.map((c) => (
          <button key={c.code} type="button" className="swatch" style={{ background: c.hex }} title={`${c.name} (&${c.code})`} onClick={() => exec("foreColor", c.hex)} />
        ))}
        <button type="button" className="swatch default" title="Varsayılan renk" onClick={() => exec("foreColor", defaultColor())}>
          ⊘
        </button>
        <span className="rich-sep" />
        <button type="button" title="Kalın (Ctrl+B)" onClick={() => exec("bold")}>
          <b>K</b>
        </button>
        <button type="button" title="İtalik (Ctrl+I)" onClick={() => exec("italic")}>
          <i>İ</i>
        </button>
        <button type="button" title="Altı çizili (Ctrl+U)" onClick={() => exec("underline")}>
          <u>A</u>
        </button>
        <button type="button" title="Üstü çizili" onClick={() => exec("strikeThrough")}>
          <s>Ü</s>
        </button>
        <button type="button" title="Biçimi temizle" onClick={() => exec("removeFormat")}>
          ⌫
        </button>
      </div>
      <div
        ref={ref}
        className="rich-input"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline={multiline}
        data-placeholder={placeholder}
        onBlur={commit}
        onInput={() => (edited.current = true)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
    </div>
  );
}
