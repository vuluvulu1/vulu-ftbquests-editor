import { useContext, useRef } from "react";
import type { QuestBook } from "../core/book";
import { importPng, type ImportedImage } from "../core/imageImport";
import { AssetsContext } from "./ItemIcon";
import { t } from "../i18n";

interface Props {
  book: QuestBook;
  label: string;
  onImported(image: ImportedImage): void;
  onError(message: string): void;
}

/** Picks a PNG from the computer and adds it to the pack (written on save). */
export function PngPicker({ book, label, onImported, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const assets = useContext(AssetsContext);
  const reason = !book.canAddTextures
    ? t("Files can't be added to the pack when it's opened this way.")
    : !assets
      ? t("Mod files are still loading…")
      : !assets.index.hasWritableSource
        ? t("This pack has no KubeJS assets folder; an added image wouldn't load in game.")
        : undefined;

  return (
    <>
      <button type="button" disabled={!!reason} title={reason ?? t("Choose a PNG file; it's copied into the pack when you save")} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow picking the same file again
          if (!file || !assets) return;
          try {
            onImported(importPng(book, assets.index, file.name, new Uint8Array(await file.arrayBuffer())));
          } catch (err) {
            onError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
    </>
  );
}
