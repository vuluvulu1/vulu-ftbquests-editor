import { useState } from "react";
import type { EditorMode } from "./mode";
import { Modal } from "./Modal";

/** Asked on first launch (and from the toolbar): how should the editor look? */
export function ModeChooser({ current, onChoose, onClose }: { current: EditorMode | null; onChoose(mode: EditorMode): void; onClose?(): void }) {
  const [choice, setChoice] = useState<EditorMode>(current ?? "simple");
  return (
    <Modal title="Nasıl kullanmak istersin?" onClose={onClose ?? (() => onChoose(choice))} width={620}>
      <div className="mode-options">
        <button className={`mode-option ${choice === "simple" ? "chosen" : ""}`} onClick={() => setChoice("simple")}>
          <span className="mode-name">
            Basit <span className="mode-badge">önerilen</span>
          </span>
          <span className="mode-desc">
            Oyun içindeki FTB Quests gibi: boş yere sağ tıklayıp görev ekle, göreve tıklayınca açılan pencereden başlık, açıklama, şart ve
            ödülleri düzenle.
          </span>
        </button>
        <button className={`mode-option ${choice === "advanced" ? "chosen" : ""}`} onClick={() => setChoice("advanced")}>
          <span className="mode-name">Gelişmiş</span>
          <span className="mode-desc">
            Bütün ayarlar sağdaki panelde, ham SNBT düzenleme dahil. FTB Quests'e hakim kullanıcılar için.
          </span>
        </button>
      </div>
      <p className="hint">Daha sonra üst çubuktaki mod düğmesinden değiştirebilirsin.</p>
      <div className="row end">
        <button className="primary" onClick={() => onChoose(choice)}>
          Devam
        </button>
      </div>
    </Modal>
  );
}
