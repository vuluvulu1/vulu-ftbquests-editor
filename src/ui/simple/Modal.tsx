import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../../i18n";

/** Open windows, innermost last: Escape closes only the top one. */
const stack: symbol[] = [];

/** FTB-style window centred over the quest book; closes on Escape or a click outside. */
export function Modal({ title, onClose, children, width = 560, className }: { title?: ReactNode; onClose(): void; children: ReactNode; width?: number; className?: string }) {
  const id = useRef(Symbol("modal")).current;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack.at(-1) !== id) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      // In a text field Escape first cancels the edit; leave the field to close the window.
      if (target?.closest("input:not([type=file]), textarea, [contenteditable]") && target.closest(".ftb-modal")) {
        target.blur();
        return;
      }
      e.stopPropagation();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
    };
  }, [id]);

  return (
    <div className="ftb-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`ftb-modal ${className ?? ""}`} style={{ width: `min(${width}px, calc(100vw - 32px))` }} role="dialog">
        {title !== undefined && (
          <div className="ftb-modal-title">
            <span>{title}</span>
            <button className="icon-button" title={t("Close (Esc)")} onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        <div className="ftb-modal-body">{children}</div>
      </div>
    </div>
  );
}
