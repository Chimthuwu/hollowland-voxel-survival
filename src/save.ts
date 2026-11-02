import { Block } from './world';

/**
 * Versioned save format. The key carries the version so a future schema can
 * live alongside this one without clobbering it.
 *
 * IMPORTANT: terrain edits are NOT persisted. The world is regenerated from
 * noise on every load, so a saved player position can land in a different
 * cave than it was saved in. Only player state, inventory and progression
 * flags round-trip. If world generation changes in a way that moves features,
 * bump SAVE_VERSION and the old save is safely ignored rather than loaded
 * into an incompatible world.
 */
export const SAVE_KEY = 'hollowland_save_v1';
export const SAVE_VERSION = 2;

export interface SaveData {
  version: number;
  savedAt: number;
  player: { x: number; y: number; z: number; health: number; sanity: number; stamina: number };
  inventory: Array<{ id: number; count: number }>;
  progression: {
    weapon: boolean;
    beam: boolean;
    hasGravity: boolean;
    hasPlatform: boolean;
    /** Best knapped tool tier, 0..3. */
    toolTier: number;
    /** Uses left on the current tool. */
    toolDurability: number;
  };
}

/**
 * Forward migrations, keyed by the version they upgrade FROM. A save is only
 * discarded when no trivial migration exists for it.
 */
const MIGRATIONS: Record<number, (data: SaveData) => SaveData> = {
  1: (data) => ({
    ...data,
    progression: { ...data.progression, toolTier: 0, toolDurability: 0 },
  }),
};

export type SaveOutcome =
  | { status: 'saved'; data: SaveData }
  | { status: 'loaded'; data: SaveData }
  | { status: 'empty' }
  | { status: 'unsupported'; version: number }
  | { status: 'corrupt'; reason: string }
  | { status: 'unavailable' };

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Access can throw in privacy modes.
    return null;
  }
}

/** Serialises a save payload. Throws on invalid input so callers can catch it. */
export function serialize(data: Omit<SaveData, 'version' | 'savedAt'>): string {
  const payload: SaveData = { ...data, version: SAVE_VERSION, savedAt: Date.now() };
  // Round-trip through JSON so a non-serialisable value fails here, not in storage.
  return JSON.stringify(payload);
}

/** Parses and validates a save payload. */
export function deserialize(raw: string): SaveOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: 'corrupt', reason: error instanceof Error ? error.message : 'invalid JSON' };
  }
  if (!parsed || typeof parsed !== 'object') return { status: 'corrupt', reason: 'not an object' };
  const candidate = parsed as Partial<SaveData>;
  if (typeof candidate.version !== 'number') return { status: 'corrupt', reason: 'missing version' };
  // A save from a newer build is ignored rather than misread.
  if (candidate.version > SAVE_VERSION) return { status: 'unsupported', version: candidate.version };
  // Older saves are migrated forward when the change is trivial.
  let data = candidate as SaveData;
  if (candidate.version < SAVE_VERSION) {
    const migrate = MIGRATIONS[candidate.version];
    if (!migrate) return { status: 'unsupported', version: candidate.version };
    data = migrate(data);
  }
  if (!data.player || typeof data.player.x !== 'number') return { status: 'corrupt', reason: 'missing player' };
  if (!Array.isArray(data.inventory)) return { status: 'corrupt', reason: 'missing inventory' };
  if (!data.progression) return { status: 'corrupt', reason: 'missing progression' };
  return { status: 'loaded', data };
}

/** Writes a save. Returns the outcome; never throws. */
export function writeSave(data: Omit<SaveData, 'version' | 'savedAt'>): SaveOutcome {
  const store = storage();
  if (!store) return { status: 'unavailable' };
  try {
    const raw = serialize(data);
    store.setItem(SAVE_KEY, raw);
    return { status: 'saved', data: JSON.parse(raw) as SaveData };
  } catch (error) {
    return { status: 'corrupt', reason: error instanceof Error ? error.message : 'write failed' };
  }
}

/** Reads the save. Returns the outcome; never throws. */
export function readSave(): SaveOutcome {
  const store = storage();
  if (!store) return { status: 'unavailable' };
  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return { status: 'unavailable' };
  }
  if (!raw) return { status: 'empty' };
  return deserialize(raw);
}

/** Deletes the save. */
export function clearSave(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    // Nothing actionable.
  }
}

/** Inventory slots as plain data. */
export function serializeInventory(slots: Array<{ id: Block; count: number }>): Array<{ id: number; count: number }> {
  return slots.map(slot => ({ id: slot.id, count: slot.count }));
}

/** Rebuilds inventory slots from plain data, dropping unknown block ids. */
export function deserializeInventory(raw: Array<{ id: number; count: number }>): Array<{ id: Block; count: number }> {
  const valid = new Set<number>(Object.values(Block).filter(v => typeof v === 'number') as number[]);
  return raw
    .filter(slot => slot && valid.has(slot.id) && Number.isInteger(slot.count) && slot.count > 0)
    .map(slot => ({ id: slot.id as Block, count: slot.count }));
}
