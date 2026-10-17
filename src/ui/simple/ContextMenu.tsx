import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ItemIcon } from "../ItemIcon";

// FTB-style right-click menu: a dark box with icon + label rows, opened at the cursor.

export type MenuItem =
  | { kind?: "item"; label: ReactNode; icon?: string; danger?: boolean; disabled?: boolean; onClick(): void }
  | { kind: "separator" }
  | { kind: "header"; label: ReactNode };

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const MenuContext = createContext<(x: number, y: number, items: MenuItem[]) => void>(() => {});

/** Opens a context menu at screen position (x, y). */
export function useContextMenu() {
  return useContext(MenuContext);
}

export function ContextMenuHost({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const open = useCallback((x: number, y: number, items: MenuItem[]) => setMenu({ x, y, items }), []);
  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </MenuContext.Provider>
  );
}

function ContextMenu({ x, y, items, onClose }: MenuState & { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="ftb-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} className="ftb-menu-sep" />;
        if (item.kind === "header") return <div key={i} className="ftb-menu-header">{item.label}</div>;
        return (
          <button
            key={i}
            className={`ftb-menu-item ${item.danger ? "danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span className="ftb-menu-icon">{item.icon ? <ItemIcon id={item.icon} size={16} fallback="" /> : null}</span>
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
