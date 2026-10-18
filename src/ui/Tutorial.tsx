import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { EditorMode } from "./simple/mode";

// First-launch tour: dims the app, outlines one area at a time and explains it in a card.
// Shown once after the first pack opens; the "?" button in the toolbar replays it.

const KEY = "ftbqe.tourDone";

export function tourDone(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true; // no storage: don't nag on every launch
  }
}

function markTourDone() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // not persisted
  }
}

interface Step {
  /** CSS selector of the area to outline; none = a centred card. */
  target?: string;
  title: string;
  text: string;
}

export function tourSteps(mode: EditorMode): Step[] {
  const simple = mode === "simple";
  return [
    {
      title: "Welcome!",
      text: "A quick tour of the editor, about a minute. You can skip it and replay it any time with the ? button in the toolbar.",
    },
    {
      target: ".sidebar",
      title: "Chapters",
      text: "Every chapter of the quest book. Click one to open it, use the green + for a new chapter, right-click to move, edit or delete.",
    },
    {
      target: ".map",
      title: "Quest map",
      text: "The chapter as it looks in game. Drag the background to pan, scroll to zoom, drag quests to move them.",
    },
    simple
      ? {
          target: ".map",
          title: "Adding quests",
          text: "Right-click an empty spot to add a quest (choose its task type) or an image. Right-click a quest for its menu.",
        }
      : {
          target: ".map",
          title: "Adding quests",
          text: "Double-click an empty spot to add a quest. Drag from the dot on a quest's right side to another quest to make a dependency.",
        },
    simple
      ? {
          target: ".react-flow__node-quest",
          title: "Quest window",
          text: "Click a quest to open its window: title, tasks, rewards, requirements and description, just like in game. The ⚙ button has the rest of its settings.",
        }
      : {
          target: ".inspector",
          title: "Settings panel",
          text: "The settings of the selected quest, image or chapter. With nothing selected it shows the chapter.",
        },
    {
      target: ".react-flow__node-quest",
      title: "Requirements",
      text: "To make quests depend on each other: Ctrl+click the quests that must be done first, then right-click the quest they unlock.",
    },
    {
      target: ".toolbar-save",
      title: "Undo and save",
      text: "Everything can be undone (Ctrl+Z). Nothing is written to your pack until you save (Ctrl+S), and a backup is made before every save.",
    },
    {
      target: ".toolbar-prefs",
      title: "Mode and language",
      text: "Switch between Simple and Advanced editing, change the language, or replay this tour.",
    },
  ];
}

const CARD_WIDTH = 340;
const GAP = 14;
const PAD = 6;

export function Tutorial({ mode, onClose }: { mode: EditorMode; onClose(): void }) {
  const steps = tourSteps(mode);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  const finish = () => {
    markTourDone();
    onClose();
  };

  // Find the step's area; follow it when the window resizes.
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step.target]);

  // Put the card beside the area: under toolbar buttons, else to its right, left, below or above,
  // whichever fits; inside it when it fills the screen.
  useLayoutEffect(() => {
    const h = card.current?.offsetHeight ?? 160;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, max: number) => Math.max(GAP, Math.min(v, max - GAP));
    if (!rect) {
      setCardPos({ left: (vw - CARD_WIDTH) / 2, top: (vh - h) / 2 });
      return;
    }
    let left: number;
    let top: number;
    if (rect.height < 80 && rect.bottom + GAP + h < vh) {
      // toolbar buttons: below, right-aligned with them
      left = rect.right - CARD_WIDTH;
      top = rect.bottom + GAP;
    } else if (rect.right + GAP + CARD_WIDTH < vw) {
      left = rect.right + GAP;
      top = rect.top;
    } else if (rect.left - GAP - CARD_WIDTH > 0) {
      left = rect.left - GAP - CARD_WIDTH;
      top = rect.top;
    } else if (rect.bottom + GAP + h < vh) {
      left = rect.left;
      top = rect.bottom + GAP;
    } else if (rect.top - GAP - h > 0) {
      left = rect.left;
      top = rect.top - GAP - h;
    } else {
      left = rect.left + (rect.width - CARD_WIDTH) / 2;
      top = rect.top + 40;
    }
    setCardPos({ left: clamp(left, vw - CARD_WIDTH), top: clamp(top, vh - h) });
  }, [rect, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") last ? finish() : setIndex((i) => i + 1);
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className={`tour ${rect ? "" : "dim"}`} role="dialog" aria-label={t(step.title)}>
      {rect && (
        <div
          className="tour-spot"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div ref={card} className="tour-card" style={{ width: CARD_WIDTH, left: cardPos?.left ?? -9999, top: cardPos?.top ?? 0 }}>
        <div className="tour-head">
          <strong>{t(step.title)}</strong>
          <span className="tour-count">
            {index + 1} / {steps.length}
          </span>
        </div>
        <p>{t(step.text)}</p>
        <div className="row">
          {!last && (
            <button className="link-button" onClick={finish}>
              {t("Skip tour")}
            </button>
          )}
          <span className="spacer" />
          {index > 0 && (
            <button className="secondary" onClick={() => setIndex(index - 1)}>
              {t("Back")}
            </button>
          )}
          <button className="primary" autoFocus onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? t("Done") : t("Next")}
          </button>
        </div>
      </div>
    </div>
  );
}
