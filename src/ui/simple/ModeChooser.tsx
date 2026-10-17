import { useState } from "react";
import { t } from "../../i18n";
import { LanguageSelect } from "../LanguageSelect";
import type { EditorMode } from "./mode";
import { Modal } from "./Modal";

/** Asked on first launch (and from the toolbar): how should the editor look? */
export function ModeChooser({ current, onChoose, onClose }: { current: EditorMode | null; onChoose(mode: EditorMode): void; onClose?(): void }) {
  const [choice, setChoice] = useState<EditorMode>(current ?? "simple");
  return (
    <Modal title={t("How do you want to edit?")} onClose={onClose ?? (() => onChoose(choice))} width={620}>
      <div className="mode-options">
        <button className={`mode-option ${choice === "simple" ? "chosen" : ""}`} onClick={() => setChoice("simple")}>
          <span className="mode-name">
            {t("Simple")} <span className="mode-badge">{t("recommended")}</span>
          </span>
          <span className="mode-desc">
            {t(
              "Like FTB Quests in game: right-click an empty spot to add a quest, click a quest to edit its title, description, tasks and rewards in its window.",
            )}
          </span>
        </button>
        <button className={`mode-option ${choice === "advanced" ? "chosen" : ""}`} onClick={() => setChoice("advanced")}>
          <span className="mode-name">{t("Advanced")}</span>
          <span className="mode-desc">{t("Every setting in a side panel, raw SNBT editing included. For people who know FTB Quests well.")}</span>
        </button>
      </div>
      <p className="hint">{t("You can change this later with the mode button in the toolbar.")}</p>
      <div className="row end">
        <LanguageSelect />
        <span className="spacer" />
        <button className="primary" onClick={() => onChoose(choice)}>
          {t("Continue")}
        </button>
      </div>
    </Modal>
  );
}
