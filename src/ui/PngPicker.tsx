import { useContext, useRef } from "react";
import type { QuestBook } from "../core/book";
import { importPng, type ImportedImage } from "../core/imageImport";
import { AssetsContext } from "./ItemIcon";

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
    ? "Bu açılış şekliyle pakete dosya eklenemiyor."
    : !assets
      ? "Mod dosyaları henüz yükleniyor…"
      : !assets.index.hasWritableSource
        ? "Bu pakette KubeJS'in assets klasörü yok; eklenen resim oyunda yüklenmez."
        : undefined;

  return (
    <>
      <button type="button" disabled={!!reason} title={reason ?? "PNG dosyası seçin; kaydettiğinizde pakete kopyalanır"} onClick={() => input.current?.click()}>
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
