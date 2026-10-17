/** Simple: edit like FTB Quests in game (right-click menus, quest window). Advanced: every setting in a side panel. */
export type EditorMode = "simple" | "advanced";

const KEY = "ftbqe.mode";

export function savedMode(): EditorMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "simple" || v === "advanced" ? v : null;
  } catch {
    return null;
  }
}

export function saveMode(mode: EditorMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // not persisted; the chooser will simply ask again next time
  }
}
