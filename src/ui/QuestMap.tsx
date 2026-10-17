import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { createContext, memo, useCallback, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { Chapter, QuestBook } from "../core/book";
import { getBool, getNumber, getString, strings } from "../core/snbt";
import { questIconId, shortItem } from "./hooks";
import { ItemIcon, ItemName, useItemIcon, useTextureImage } from "./ItemIcon";
import { McText } from "./McText";

/** Pixels per FTB quest-grid unit. */
export const GRID = 56;

interface QuestNodeData extends Record<string, unknown> {
  title: string;
  subtitle?: string;
  /** Shown as the title when the quest has none (FTB uses the first task's name). */
  titleItem?: string;
  iconId?: string;
  /** Placeholder when no icon texture is available. */
  iconText: string;
  shape: string;
  size: number;
  link?: boolean;
  warning?: string;
}

type QuestNode = Node<QuestNodeData, "quest">;

/** In game, titles only appear in a tooltip on hover; the map can also show them all. */
const ShowTitlesContext = createContext(false);
const SHOW_TITLES_KEY = "ftbqe.showTitles";

/** FTB Quests' own shape textures (background + outline), tinted with CSS masks; CSS shapes as fallback. */
function QuestShape({ shape, selected, link, children }: { shape: string; selected: boolean; link?: boolean; children: ReactNode }) {
  const name = shape || "circle";
  const background = useItemIcon(`texture:ftbquests:textures/shapes/${name}/background.png`);
  const outline = useItemIcon(`texture:ftbquests:textures/shapes/${name}/outline.png`);
  const state = `${selected ? "selected" : ""} ${link ? "link" : ""}`;
  if (!background || !outline) {
    return <div className={`quest-shape shape-${name} ${state}`}>{children}</div>;
  }
  // The texture is drawn as-is and multiplied by the layer's tint (white = untouched, like FTB's
  // default colors); the same texture as a mask keeps the outside transparent.
  const mask = (url: string) => ({ backgroundImage: `url(${url})`, maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` });
  return (
    <div className={`ftb-shape ${state}`}>
      <div className="ftb-layer background" style={mask(background)} />
      <div className="ftb-layer outline" style={mask(outline)} />
      {children}
    </div>
  );
}

const QuestNodeView = memo(function QuestNodeView({ data, selected }: NodeProps<QuestNode>) {
  const showTitles = useContext(ShowTitlesContext);
  const px = data.size * GRID * 0.8;
  const title = (
    <>
      {data.link && "↪ "}
      {data.title ? <McText text={data.title} /> : data.titleItem ? <ItemName id={data.titleItem} /> : null}
    </>
  );
  return (
    <div className="quest-node" style={{ width: px, height: px }}>
      <QuestShape shape={data.shape} selected={!!selected} link={data.link}>
        <span className="quest-icon">
          <ItemIcon id={data.iconId} size={Math.round(px * 0.6)} fallback={data.iconText} />
        </span>
      </QuestShape>
      {data.warning && <span className="quest-warning">!</span>}
      {showTitles ? (
        <div className="quest-title">{title}</div>
      ) : (
        <div className="mc-tooltip">
          <div className="mc-tooltip-title">{title}</div>
          {data.subtitle && (
            <div className="mc-tooltip-sub">
              <McText text={data.subtitle} />
            </div>
          )}
          {data.warning && <div className="mc-tooltip-warn">{data.warning}</div>}
        </div>
      )}
      <Handle id="in" type="target" position={Position.Top} className="center-handle" isConnectableStart={false} />
      <Handle id="out" type="source" position={Position.Top} className="center-handle" isConnectable={false} />
      {!data.link && <Handle id="link" type="source" position={Position.Right} className="link-handle" title="Bağımlılık eklemek için sürükleyin" />}
    </div>
  );
});

interface ImageNodeData extends Record<string, unknown> {
  ref: string;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Only shown in game once this quest is completed (e.g. an opened letter). */
  dependency?: string;
  dependencyTitle?: string;
  dev: boolean;
  hover: string[];
}

type ImageNode = Node<ImageNodeData, "image">;
type MapNode = QuestNode | ImageNode;

/** A chapter image (FTB "images"): drawn at its size and rotation, behind the quests. */
const ImageNodeView = memo(function ImageNodeView({ data, selected }: NodeProps<ImageNode>) {
  const url = useTextureImage(data.ref);
  return (
    <div
      className={`map-image ${selected ? "selected" : ""} ${data.dev ? "dev" : ""}`}
      style={{ width: data.width, height: data.height, opacity: data.opacity }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} style={{ transform: data.rotation ? `rotate(${data.rotation}deg)` : undefined }} />
      ) : (
        <span className="map-image-missing">{url === null ? `bulunamadı: ${data.ref}` : ""}</span>
      )}
      {data.dependency && (
        <span className="map-image-badge" title={`"${data.dependencyTitle ?? data.dependency}" tamamlanınca görünür`}>
          ⧗
        </span>
      )}
      {(data.hover.length > 0 || data.dependency) && (
        <div className="mc-tooltip">
          {data.hover.map((line, i) => (
            <div key={i}>
              <McText text={line} />
            </div>
          ))}
          {data.dependency && <div className="mc-tooltip-sub">Görünür: {data.dependencyTitle ?? data.dependency} tamamlanınca</div>}
        </div>
      )}
    </div>
  );
});

const nodeTypes = { quest: QuestNodeView, image: ImageNodeView };

/** What the map asks its owner to do (menus and windows live outside the map). */
export interface MapActions {
  openQuest(id: string): void;
  openImage(index: number): void;
  paneMenu(e: MouseEvent | globalThis.MouseEvent, x: number, y: number): void;
  nodeMenu(e: MouseEvent | globalThis.MouseEvent, nodeId: string, selection: string[]): void;
}

interface Props {
  book: QuestBook;
  chapter: Chapter;
  version: number;
  /** In-game style: click opens the quest window, quests are added from the right-click menu. */
  simple: boolean;
  actions: MapActions;
  selectedQuest: string | null;
  selectedImage: number | null;
  onSelect(questId: string | null): void;
  onSelectImage(index: number | null): void;
  onError(message: string): void;
}

const SHOW_CONDITIONAL_KEY = "ftbqe.showConditionalImages";
const imageIndex = (nodeId: string) => (nodeId.startsWith("img:") ? Number(nodeId.slice(4)) : undefined);

export function QuestMap({ book, chapter, version, simple, actions, selectedQuest, selectedImage, onSelect, onSelectImage, onError }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition, getNodes } = useReactFlow();
  const toGrid = (clientX: number, clientY: number) => {
    const p = screenToFlowPosition({ x: clientX, y: clientY });
    const round = (v: number) => Math.round((v / GRID) * 2) / 2;
    return { x: round(p.x), y: round(p.y) };
  };
  const [showConditional, setShowConditional] = useState(() => {
    try {
      return localStorage.getItem(SHOW_CONDITIONAL_KEY) !== "0";
    } catch {
      return true;
    }
  });

  // Rebuild the graph from the book whenever it changes.
  useEffect(() => {
    const defaultShape =
      getString(chapter.root, "default_quest_shape") || (book.data && getString(book.data, "default_quest_shape")) || "circle";
    const quests = book.quests(chapter);
    const inChapter = new Set(quests.map((q) => getString(q, "id")));

    const questNodes: QuestNode[] = quests.map((q) => {
      const id = getString(q, "id")!;
      const firstTask = book.tasks(q)[0];
      const iconId = questIconId(book, q);
      return {
        id,
        type: "quest",
        position: { x: (getNumber(q, "x") ?? 0) * GRID, y: (getNumber(q, "y") ?? 0) * GRID },
        selected: id === selectedQuest,
        data: {
          title: book.getText("quest", q, "title"),
          subtitle: book.getText("quest", q, "subtitle") || undefined,
          titleItem: (firstTask && book.itemId(firstTask)) || undefined,
          iconId,
          iconText: iconId ? shortItem(iconId) : (firstTask && getString(firstTask, "type")) || "",
          shape: getString(q, "shape") || defaultShape,
          size: getNumber(q, "size") ?? 1,
          warning: book.tasks(q).length === 0 ? "Bu görevin hiç şartı yok" : undefined,
        },
      };
    });

    const linkNodes: QuestNode[] = book.questLinks(chapter).flatMap((l) => {
      const target = book.quest(getString(l, "linked_quest") ?? "");
      if (!target) return [];
      return [
        {
          id: `link:${getString(l, "id")}`,
          type: "quest" as const,
          position: { x: (getNumber(l, "x") ?? 0) * GRID, y: (getNumber(l, "y") ?? 0) * GRID },
          data: {
            title: book.getText("quest", target.quest, "title"),
            iconId: questIconId(book, target.quest),
            iconText: "link",
            shape: getString(l, "shape") || defaultShape,
            size: getNumber(l, "size") ?? 1,
            link: true,
          },
        },
      ];
    });

    const imageNodes: ImageNode[] = book.images(chapter).flatMap((img, i) => {
      const dependency = getString(img, "dependency") || undefined;
      if (dependency && !showConditional) return [];
      const width = getNumber(img, "width") ?? 1;
      const height = getNumber(img, "height") ?? 1;
      const corner = getBool(img, "corner") ?? false;
      const x = (getNumber(img, "x") ?? 0) + (corner ? width / 2 : 0);
      const y = (getNumber(img, "y") ?? 0) + (corner ? height / 2 : 0);
      const target = dependency ? book.quest(dependency) : undefined;
      const order = getNumber(img, "order") ?? 0;
      return [
        {
          id: `img:${i}`,
          type: "image" as const,
          position: { x: x * GRID, y: y * GRID },
          selected: i === selectedImage,
          // Behind quests (and lines) unless the pack asked for a higher order.
          zIndex: order > 0 ? 1 : -1,
          data: {
            ref: getString(img, "image") ?? "",
            width: width * GRID,
            height: height * GRID,
            rotation: getNumber(img, "rotation") ?? 0,
            opacity: (getNumber(img, "alpha") ?? 255) / 255,
            dependency,
            dependencyTitle: target ? book.getText("quest", target.quest, "title") || undefined : undefined,
            dev: getBool(img, "dev") ?? false,
            hover: strings(img.entries.get("hover")),
          },
        },
      ];
    });

    setNodes([...imageNodes, ...questNodes, ...linkNodes]);
    setEdges(
      quests.flatMap((q) => {
        const id = getString(q, "id")!;
        return book
          .dependencies(q)
          .filter((d) => inChapter.has(d))
          .map((d) => ({ id: `${d}->${id}`, source: d, target: id, sourceHandle: "out", targetHandle: "in", type: "straight" }));
      }),
    );
    // selectedQuest is intentionally not a dependency: selection changes are handled by React Flow itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, version, showConditional]);

  // Keep the map's selection in step with a quest or image chosen from outside
  // (a dependency clicked in the panel, an image just added).
  useEffect(() => {
    setNodes((all) =>
      all.map((n) => {
        const selected = n.id === selectedQuest || n.id === `img:${selectedImage}`;
        return n.selected === selected ? n : { ...n, selected };
      }),
    );
  }, [selectedQuest, selectedImage, setNodes]);

  const toggleConditional = () => {
    setShowConditional((v) => {
      try {
        localStorage.setItem(SHOW_CONDITIONAL_KEY, v ? "0" : "1");
      } catch {
        // storage unavailable: setting just won't persist
      }
      return !v;
    });
  };

  // Like in game, the selected quest's lines light up and move: what it requires in
  // cyan, what it unlocks in yellow (FTB's dependency_line_requires / required_for colours).
  useEffect(() => {
    setEdges((all) =>
      all.map((e) => {
        const className = !selectedQuest ? undefined : e.target === selectedQuest ? "requires" : e.source === selectedQuest ? "required-for" : undefined;
        return e.className === className ? e : { ...e, className };
      }),
    );
  }, [selectedQuest, version, setEdges]);

  const [showTitles, setShowTitles] = useState(() => {
    try {
      return localStorage.getItem(SHOW_TITLES_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleTitles = () => {
    setShowTitles((v) => {
      try {
        localStorage.setItem(SHOW_TITLES_KEY, v ? "0" : "1");
      } catch {
        // storage unavailable: setting just won't persist
      }
      return !v;
    });
  };

  const backdrop = useItemIcon("texture:ftblibrary:textures/gui/background_squares.png");

  const onNodeDragStop = useCallback(
    (_: unknown, __: MapNode, dragged: MapNode[]) => {
      const images = book.images(chapter);
      book.edit("taşı", () => {
        for (const n of dragged) {
          const x = n.position.x / GRID;
          const y = n.position.y / GRID;
          const img = imageIndex(n.id);
          if (img !== undefined) book.moveImage(chapter, images[img]!, x, y);
          else if (n.id.startsWith("link:")) book.moveQuestLink(chapter, n.id.slice(5), x, y);
          else book.moveQuest(n.id, x, y);
        }
      }, chapter.root);
    },
    [book, chapter],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const target = book.quest(c.target)?.quest;
      if (!target || c.target.startsWith("link:")) return;
      try {
        book.addDependency(target, c.source);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    },
    [book, onError],
  );

  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: MapNode[]; edges: Edge[] }) => {
      const images = book.images(chapter);
      book.edit("sil", () => {
        for (const e of deletedEdges) {
          const target = book.quest(e.target)?.quest;
          if (target) book.removeDependency(target, e.source);
        }
        for (const n of deletedNodes) {
          const img = imageIndex(n.id);
          if (img !== undefined) book.deleteImage(chapter, images[img]!);
          else if (!n.id.startsWith("link:")) book.deleteQuest(n.id);
        }
      }, chapter.root);
      onSelect(null);
      onSelectImage(null);
    },
    [book, chapter, onSelect, onSelectImage],
  );

  const onDoubleClick = useCallback(
    (e: MouseEvent) => {
      // Simple mode adds quests from the right-click menu, as in game.
      if (simple || !(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const round = (v: number) => Math.round((v / GRID) * 2) / 2;
      const quest = book.addQuest(chapter, round(p.x), round(p.y));
      onSelect(getString(quest, "id")!);
    },
    [book, chapter, screenToFlowPosition, onSelect, simple],
  );

  return (
    <ShowTitlesContext.Provider value={showTitles}>
    <div className="map" onDoubleClick={onDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.5 }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onDelete={onDelete}
        onBeforeDelete={async ({ nodes: n, edges: e }) => {
          const quests = n.filter((x) => x.type === "quest" && !x.id.startsWith("link:")).length;
          return quests === 0 || window.confirm(`${quests} görev silinsin mi? (Geri alınabilir)`) ? { nodes: n, edges: e } : false;
        }}
        // Selection follows explicit clicks: React Flow's selection-change event also fires when
        // nodes are rebuilt, which would clear a selection made from outside (a just-added image).
        onNodeClick={(e, node) => {
          const img = imageIndex(node.id);
          const multi = e.ctrlKey || e.metaKey || e.shiftKey;
          if (multi) return; // React Flow toggles it in the selection (used for adding dependencies)
          onSelectImage(img ?? null);
          const quest = img === undefined && !node.id.startsWith("link:") ? node.id : null;
          onSelect(quest);
          if (simple && quest) actions.openQuest(quest);
        }}
        onNodeDoubleClick={(_, node) => {
          const img = imageIndex(node.id);
          if (img !== undefined) actions.openImage(img);
        }}
        onNodeContextMenu={(e, node) => {
          e.preventDefault();
          const selection = getNodes()
            .filter((n) => n.selected)
            .map((n) => n.id);
          actions.nodeMenu(e, node.id, selection);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const p = toGrid(e.clientX, e.clientY);
          actions.paneMenu(e, p.x, p.y);
        }}
        onNodeDragStart={(_, node) => {
          const img = imageIndex(node.id);
          onSelectImage(img ?? null);
          onSelect(img === undefined && !node.id.startsWith("link:") ? node.id : null);
        }}
        onPaneClick={() => {
          onSelect(null);
          onSelectImage(null);
        }}
        snapToGrid
        snapGrid={[GRID / 4, GRID / 4]}
        connectionRadius={40}
        zoomOnDoubleClick={false}
        deleteKeyCode={["Delete", "Backspace"]}
        minZoom={0.1}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        {!backdrop && <Background variant={BackgroundVariant.Dots} gap={GRID / 2} color="#3a3a3a" />}
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#8b8b8b" maskColor="rgba(0,0,0,0.65)" />
        <Panel position="top-right" className="map-toggles">
          <button className={`map-toggle ${showTitles ? "on" : ""}`} onClick={toggleTitles} title="Oyunda başlıklar sadece fareyle üzerine gelince görünür">
            Başlıklar: {showTitles ? "açık" : "üzerine gelince"}
          </button>
          <button
            className={`map-toggle ${showConditional ? "on" : ""}`}
            onClick={toggleConditional}
            title="Bazı resimler oyunda ancak bir görev tamamlanınca görünür (ör. açılan mektup)"
          >
            Koşullu resimler: {showConditional ? "göster" : "gizle"}
          </button>
        </Panel>
      </ReactFlow>
    </div>
    </ShowTitlesContext.Provider>
  );
}
