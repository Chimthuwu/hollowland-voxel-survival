/**
 * Pure multiplayer protocol shared by the browser client and the relay.
 *
 * The world is regenerated from its seed on every client, so only three kinds
 * of state cross the wire: player transforms, individual block edits, and
 * enemy snapshots authored by the host. No terrain chunks are ever sent.
 */
export const MAX_PLAYERS = 6;
export const MAX_EDITS = 4096;
export const MAX_ENEMIES = 64;

export interface PlayerState {
  id: string;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  health: number;
}

export interface WorldEdit {
  /** Voxel coordinates (integers). */
  x: number; y: number; z: number;
  block: number;
  /** Monotonic per-author sequence; newest edit at a cell wins. */
  seq: number;
  author: string;
}

export interface EnemyState {
  id: string;
  kind: string;
  x: number; y: number; z: number;
  yaw: number; hp: number;
}

export interface RoomState {
  players: Record<string, PlayerState>;
  edits: WorldEdit[];
  enemies: Record<string, EnemyState>;
}

export type Message =
  | { t: 'player'; state: PlayerState }
  | { t: 'leave'; id: string }
  | { t: 'edit'; edit: WorldEdit }
  | { t: 'enemies'; from: string; enemies: EnemyState[] }
  | { t: 'sync'; room: RoomState };

export function createRoom(): RoomState {
  return { players: {}, edits: [], enemies: {} };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown): boolean => !!v && typeof v === 'object'
  && finite((v as Record<string, unknown>).x)
  && finite((v as Record<string, unknown>).y)
  && finite((v as Record<string, unknown>).z);

export function isPlayerState(v: unknown): v is PlayerState {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 64
    && vec(v) && finite(p.yaw) && finite(p.pitch) && finite(p.health);
}

export function isWorldEdit(v: unknown): v is WorldEdit {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return Number.isInteger(e.x) && Number.isInteger(e.y) && Number.isInteger(e.z)
    && Number.isInteger(e.block) && finite(e.seq)
    && typeof e.author === 'string' && e.author.length > 0;
}

export function isEnemyState(v: unknown): v is EnemyState {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === 'string' && e.id.length > 0 && typeof e.kind === 'string'
    && vec(v) && finite(e.yaw) && finite(e.hp);
}

/** The host is the lexicographically lowest connected id: identical on every client. */
export function hostId(room: RoomState): string | null {
  const ids = Object.keys(room.players);
  return ids.length ? ids.sort()[0] : null;
}

export function applyPlayer(room: RoomState, state: PlayerState): RoomState {
  if (!isPlayerState(state)) return room;
  const known = Object.prototype.hasOwnProperty.call(room.players, state.id);
  if (!known && Object.keys(room.players).length >= MAX_PLAYERS) return room; // room full
  room.players[state.id] = { ...state };
  return room;
}

export function removePlayer(room: RoomState, id: string): RoomState {
  delete room.players[id];
  return room;
}

/**
 * Applies a block edit. One edit per voxel, newest sequence wins, and the
 * history is capped so a long session cannot grow memory without bound.
 */
export function applyEdit(room: RoomState, edit: WorldEdit): RoomState {
  if (!isWorldEdit(edit)) return room;
  const at = room.edits.findIndex(e => e.x === edit.x && e.y === edit.y && e.z === edit.z);
  if (at >= 0) {
    if (edit.seq >= room.edits[at].seq) room.edits[at] = { ...edit };
  } else {
    room.edits.push({ ...edit });
    if (room.edits.length > MAX_EDITS) room.edits.shift();
  }
  return room;
}

/** Only the host's enemy snapshot is authoritative; everyone else is ignored. */
export function applyEnemies(room: RoomState, from: string, enemies: EnemyState[]): RoomState {
  if (from !== hostId(room) || !Array.isArray(enemies)) return room;
  room.enemies = {};
  for (const enemy of enemies.slice(0, MAX_ENEMIES)) {
    if (isEnemyState(enemy)) room.enemies[enemy.id] = { ...enemy };
  }
  return room;
}

export function encode(msg: Message): string { return JSON.stringify(msg); }

/** Parses a relay message. Returns null for malformed or untrusted payloads. */
export function decode(raw: string): Message | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  switch (m.t) {
    case 'player': return isPlayerState(m.state) ? { t: 'player', state: m.state } : null;
    case 'leave': return typeof m.id === 'string' ? { t: 'leave', id: m.id } : null;
    case 'edit': return isWorldEdit(m.edit) ? { t: 'edit', edit: m.edit } : null;
    case 'enemies':
      return typeof m.from === 'string' && Array.isArray(m.enemies) && m.enemies.every(isEnemyState)
        ? { t: 'enemies', from: m.from, enemies: m.enemies } : null;
    case 'sync':
      return m.room && typeof m.room === 'object'
        ? { t: 'sync', room: m.room as RoomState } : null;
    default: return null;
  }
}
