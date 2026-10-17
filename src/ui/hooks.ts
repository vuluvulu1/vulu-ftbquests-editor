import { useSyncExternalStore } from "react";
import type { QuestBook } from "../core/book";
import { taskTypeIcon } from "../core/registry";
import { getString, type SnbtCompound } from "../core/snbt";

const noop = () => () => {};

/** Re-renders the calling component whenever the book changes. */
export function useBookVersion(book: QuestBook | null): number {
  return useSyncExternalStore(book ? (cb) => book.subscribe(cb) : noop, () => book?.version ?? 0);
}

/** Item shown for a quest, as FTB picks it: its own icon, else the first task's icon or item. */
export function questIconId(book: QuestBook, quest: SnbtCompound): string | undefined {
  const firstTask = book.tasks(quest)[0];
  const own = book.iconRef(quest, "icon");
  if (own) return own;
  if (!firstTask) return undefined;
  return book.iconRef(firstTask, "icon") || book.iconRef(firstTask) || taskTypeIcon(getString(firstTask, "type"));
}

/** Last path segment of an item id, e.g. `minecraft:oak_log` -> `oak_log`. */
export function shortItem(id: string): string {
  return id.split(":").pop() ?? id;
}
