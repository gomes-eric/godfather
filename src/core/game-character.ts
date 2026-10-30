// Pure parsing of the official Aion 2 character API (aion2.plaync.com, the same data shugo.gg
// shows). Every field is read defensively: the API is undocumented and may change.

import { obj, str } from './text.js';

export interface CharacterRef {
  /** Opaque id from the search API (base64, already URL-decoded). */
  id: string;
  name: string;
  serverId: number;
}

export interface CharacterProfile extends CharacterRef {
  className: string;
  level: number;
  combatPower: number | null;
  itemLevel: number | null;
  /** In-game legion name; empty when the character has none. */
  legion: string;
  title: string | null;
  avatarUrl: string | null;
}

export type EquipmentGroup = 'weapons' | 'armor' | 'accessories' | 'runes' | 'arcana';

export interface EquipmentItem {
  /** Item id in the game data (0 when the site left it out); with the slot it fetches the details. */
  id: number;
  /** Slot number the official site uses to fetch this piece's details. */
  slotPos: number;
  name: string;
  slot: string;
  group: EquipmentGroup;
  enchantLevel: number;
  exceedLevel: number;
  grade: string;
}

const GROUP_SLOTS: Record<EquipmentGroup, string[]> = {
  weapons: ['MainHand', 'SubHand'],
  armor: ['Helmet', 'Shoulder', 'Torso', 'Pants', 'Gloves', 'Boots', 'Cape'],
  accessories: [
    'Necklace',
    'Earring1',
    'Earring2',
    'Ring1',
    'Ring2',
    'Bracelet1',
    'Bracelet2',
    'Belt',
    'Amulet',
  ],
  runes: ['Rune1', 'Rune2'],
  arcana: ['Arcana1', 'Arcana2', 'Arcana3', 'Arcana4', 'Arcana5'],
};
const SLOT_ORDER = Object.values(GROUP_SLOTS).flat();

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** "<strong>Padrinho</strong>" → "Padrinho". */
function plainName(value: unknown): string {
  return str(value)
    .replace(/<[^>]*>/g, '')
    .trim();
}

function decodeId(value: unknown): string {
  const raw = str(value);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** The character with exactly this name (any case) on this server, from a search response. */
export function parseSearch(json: unknown, name: string, serverId: number): CharacterRef | null {
  const list = obj(json).list;
  if (!Array.isArray(list)) return null;
  const wanted = name.toLocaleLowerCase('pt-BR');
  for (const entry of list.map(obj)) {
    const found = plainName(entry.name);
    if (num(entry.serverId) === serverId && found.toLocaleLowerCase('pt-BR') === wanted) {
      return { id: decodeId(entry.characterId), name: found, serverId };
    }
  }
  return null;
}

export function parseProfile(json: unknown): CharacterProfile | null {
  const root = obj(json);
  const profile = obj(root.profile);
  const name = str(profile.characterName);
  const id = str(profile.characterId);
  const serverId = num(profile.serverId);
  if (!name || !id || serverId === null) return null;

  const stats = obj(root.stat).statList;
  const itemLevel = Array.isArray(stats)
    ? num(stats.map(obj).find((s) => s.type === 'ItemLevel')?.value)
    : null;
  return {
    id,
    name,
    serverId,
    className: str(profile.className),
    level: num(profile.characterLevel) ?? 0,
    combatPower: num(profile.combatPower),
    itemLevel,
    legion: str(profile.regionName).trim(),
    title: str(profile.titleName) || null,
    avatarUrl: str(profile.profileImage) || null,
  };
}

function groupOf(slot: string): EquipmentGroup | null {
  for (const [group, slots] of Object.entries(GROUP_SLOTS) as [EquipmentGroup, string[]][]) {
    if (slots.includes(slot)) return group;
  }
  return null;
}

/** Equipped items in display order; cosmetic skins and unknown slots are left out. */
export function parseEquipment(json: unknown): EquipmentItem[] {
  const list = obj(obj(json).equipment).equipmentList;
  if (!Array.isArray(list)) return [];
  const items: EquipmentItem[] = [];
  for (const entry of list.map(obj)) {
    const slot = str(entry.slotPosName);
    const group = groupOf(slot);
    const name = str(entry.name);
    if (!group || !name) continue;
    items.push({
      id: num(entry.id) ?? 0,
      slotPos: num(entry.slotPos) ?? 0,
      name,
      slot,
      group,
      enchantLevel: num(entry.enchantLevel) ?? 0,
      exceedLevel: num(entry.exceedLevel) ?? 0,
      grade: str(entry.grade),
    });
  }
  return items.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

/** "+15 Martelo ✦3": enchant, name and the exceed (breakthrough) level when there is one. */
export function itemLabel(item: EquipmentItem): string {
  const enchant = item.enchantLevel > 0 ? `+${item.enchantLevel} ` : '';
  const exceed = item.exceedLevel > 0 ? ` ✦${item.exceedLevel}` : '';
  return `${enchant}${item.name}${exceed}`;
}

/** One equipped piece in full, as the official site's item tooltip shows it. */
export interface ItemDetail {
  name: string;
  /** "Único", "Lendário"… in Portuguese. */
  gradeName: string;
  icon: string | null;
  /** Item level (the "Nível 45" on the tooltip). */
  level: number | null;
  enchantLevel: number;
  maxEnchantLevel: number | null;
  /** "Maça", "Runa"… */
  category: string;
  /** Classes that can use it; empty when every class can. */
  classes: string[];
  /** Base stats; `extra` is what the enchantment adds ("+50"), null when it adds nothing. */
  mainStats: { name: string; value: string; extra: string | null }[];
  subStats: { name: string; value: string }[];
  magicStones: { name: string; value: string }[];
  godStones: { name: string; description: string }[];
  tradable: boolean;
  /** Where it drops or comes from ("Campanha", "Baú de Recompensa"…). */
  sources: string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter(Boolean) : [];
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(obj) : [];
/** "0", "0%" and "" mean the enchantment adds nothing. */
const statExtra = (value: unknown): string | null => {
  const text = str(value);
  return /^[+-]?0(\.0+)?%?$/.test(text) || !text ? null : `+${text.replace(/^\+/, '')}`;
};

/** An equipped item's details (/api/character/equipment/item), or null when the answer is unusable. */
export function parseItemDetail(json: unknown): ItemDetail | null {
  const item = obj(json);
  const name = str(item.name);
  if (!name) return null;
  return {
    name,
    gradeName: str(item.gradeName) || str(item.grade),
    icon: str(item.icon) || null,
    level: num(item.level),
    enchantLevel: num(item.enchantLevel) ?? 0,
    maxEnchantLevel: num(item.maxEnchantLevel),
    category: str(item.categoryName),
    classes: strings(item.classNames),
    mainStats: records(item.mainStats)
      .map((s) => ({ name: str(s.name), value: str(s.value), extra: statExtra(s.extra) }))
      .filter((s) => s.name && s.value),
    subStats: records(item.subStats)
      .map((s) => ({ name: str(s.name), value: str(s.value) }))
      .filter((s) => s.name && s.value),
    magicStones: records(item.magicStoneStat)
      .map((s) => ({ name: str(s.name), value: str(s.value) }))
      .filter((s) => s.name),
    godStones: records(item.godStoneStat)
      .map((s) => ({ name: str(s.name), description: str(s.desc) }))
      .filter((s) => s.name),
    tradable: item.tradable === true,
    sources: strings(item.sources),
  };
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** The class role whose name is the game's class name ("Clérigo" ↔ "Clérigo"), if any. */
export function matchClass<T extends { name: string }>(
  className: string,
  classRoles: readonly T[],
): T | undefined {
  const wanted = fold(className);
  return wanted ? classRoles.find((role) => fold(role.name) === wanted) : undefined;
}

/** Same legion, ignoring case and accents. */
export function sameLegion(a: string, b: string): boolean {
  return fold(a) !== '' && fold(a) === fold(b);
}
