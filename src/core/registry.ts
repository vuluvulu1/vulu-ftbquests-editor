import { bool, compound, int, long, str, type SnbtCompound } from "./snbt";

/**
 * Task and reward types the editor knows how to create and edit with a form.
 * Any other type (including ones added by addon mods) still loads, saves and
 * can be edited through the raw SNBT editor.
 */

/** `table` is a reward table reference stored as a signed 64-bit `table_id`. */
export type FieldKind = "item" | "string" | "int" | "long" | "bool" | "table";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
}

export interface TypeSpec {
  type: string;
  label: string;
  fields: FieldSpec[];
  /** Initial fields for a new object, without `id`, `type` and `item`. */
  create(): SnbtCompound;
  /** Whether a new object starts with an `item` field. */
  hasItem?: boolean;
}

export const TASK_TYPES: TypeSpec[] = [
  {
    type: "item",
    label: "Eşya",
    hasItem: true,
    fields: [
      { key: "item", label: "Eşya", kind: "item" },
      { key: "count", label: "Adet", kind: "long" },
      { key: "consume_items", label: "Eşyaları tüket", kind: "bool" },
    ],
    create: () => compound(),
  },
  { type: "checkmark", label: "Onay kutusu", fields: [], create: () => compound() },
  {
    type: "kill",
    label: "Yaratık öldür",
    fields: [
      { key: "entity", label: "Varlık", kind: "string" },
      { key: "value", label: "Adet", kind: "long" },
    ],
    create: () => compound({ entity: str("minecraft:zombie"), value: long(1) }),
  },
  {
    type: "xp",
    label: "Tecrübe",
    fields: [
      { key: "value", label: "Miktar", kind: "long" },
      { key: "points", label: "Seviye değil puan", kind: "bool" },
    ],
    create: () => compound({ value: long(10) }),
  },
  {
    type: "advancement",
    label: "Başarım",
    fields: [
      { key: "advancement", label: "Başarım", kind: "string" },
      { key: "criterion", label: "Kriter", kind: "string" },
    ],
    create: () => compound({ advancement: str("minecraft:story/root"), criterion: str("") }),
  },
  {
    type: "dimension",
    label: "Boyut",
    fields: [{ key: "dimension", label: "Boyut", kind: "string" }],
    create: () => compound({ dimension: str("minecraft:the_nether") }),
  },
];

export const REWARD_TYPES: TypeSpec[] = [
  {
    type: "item",
    label: "Eşya",
    hasItem: true,
    fields: [
      { key: "item", label: "Eşya", kind: "item" },
      { key: "count", label: "Adet", kind: "int" },
    ],
    create: () => compound(),
  },
  {
    type: "xp",
    label: "Tecrübe puanı",
    fields: [{ key: "xp", label: "Puan", kind: "int" }],
    create: () => compound({ xp: int(100) }),
  },
  {
    type: "xp_levels",
    label: "Tecrübe seviyesi",
    fields: [{ key: "xp_levels", label: "Seviye", kind: "int" }],
    create: () => compound({ xp_levels: int(5) }),
  },
  ...(
    [
      ["loot", "Ganimet sandığı"],
      ["random", "Tablodan rastgele"],
      ["choice", "Tablodan seçmeli"],
    ] as const
  ).map(
    ([type, label]): TypeSpec => ({
      type,
      label,
      fields: [
        { key: "table_id", label: "Ödül tablosu", kind: "table" },
        { key: "exclude_from_claim_all", label: "\"Hepsini al\"a dahil etme", kind: "bool" },
      ],
      create: () => compound(),
    }),
  ),
  {
    type: "command",
    label: "Komut",
    fields: [
      { key: "command", label: "Komut", kind: "string" },
      { key: "elevate_perms", label: "Yetkili çalıştır", kind: "bool" },
      { key: "silent", label: "Sessiz", kind: "bool" },
    ],
    create: () => compound({ command: str("/say Tebrikler!"), elevate_perms: bool(false) }),
  },
];

export function taskSpec(type: string | undefined) {
  return TASK_TYPES.find((t) => t.type === type);
}

export function rewardSpec(type: string | undefined) {
  return REWARD_TYPES.find((t) => t.type === type);
}

/**
 * What FTB-like icon to show for tasks without an item (`texture:` refs point at
 * FTB Library / FTB Quests textures, which every pack using FTB Quests has).
 */
const TASK_TYPE_ICONS: Record<string, string> = {
  checkmark: "texture:ftblibrary:textures/icons/accept.png",
  kill: "minecraft:diamond_sword",
  xp: "minecraft:experience_bottle",
  advancement: "minecraft:knowledge_book",
  dimension: "minecraft:obsidian",
  location: "texture:ftblibrary:textures/icons/marker.png",
  biome: "minecraft:oak_sapling",
  structure: "minecraft:chiseled_stone_bricks",
  stat: "texture:ftblibrary:textures/icons/info.png",
  observation: "minecraft:spyglass",
  fluid: "minecraft:water_bucket",
  forge_energy: "texture:ftbquests:textures/tasks/fe_full.png",
  gamestage: "texture:ftblibrary:textures/icons/star.png",
};

export function taskTypeIcon(type: string | undefined): string {
  return TASK_TYPE_ICONS[type ?? ""] ?? "texture:ftblibrary:textures/icons/notes.png";
}

export const QUEST_SHAPES = ["", "circle", "square", "rsquare", "diamond", "pentagon", "hexagon", "octagon", "heart", "gear"];
