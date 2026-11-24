import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS, applyEdit, applyEnemies, applyPlayer, createRoom, decode, encode,
  hostId, isPlayerState, removePlayer, type EnemyState, type PlayerState,
} from '../src/net/protocol';

const player = (id: string): PlayerState => ({ id, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 });
const enemy = (id: string): EnemyState => ({ id, kind: 'stalker', x: 0, y: 0, z: 0, yaw: 0, hp: 10 });

describe('multiplayer room state', () => {
  it('caps a room at six players and still lets known players rejoin', () => {
    const room = createRoom();
    for (let i = 0; i < MAX_PLAYERS + 2; i++) applyPlayer(room, player(`p${i}`));
    expect(Object.keys(room.players)).toHaveLength(MAX_PLAYERS);
    applyPlayer(room, { ...player('p0'), x: 99 });
    expect(room.players.p0.x).toBe(99);
    removePlayer(room, 'p1');
    applyPlayer(room, player('late'));
    expect(Object.keys(room.players)).toHaveLength(MAX_PLAYERS);
    expect(room.players.late).toBeDefined();
  });

  it('elects the same host independent of join order', () => {
    const a = createRoom(), b = createRoom();
    for (const id of ['zoe', 'amy', 'kim']) applyPlayer(a, player(id));
    for (const id of ['kim', 'zoe', 'amy']) applyPlayer(b, player(id));
    expect(hostId(a)).toBe('amy');
    expect(hostId(b)).toBe('amy');
    expect(hostId(createRoom())).toBeNull();
  });

  it('keeps one edit per voxel with the newest sequence', () => {
    const room = createRoom();
    applyEdit(room, { x: 1, y: 2, z: 3, block: 2, seq: 1, author: 'a' });
    applyEdit(room, { x: 4, y: 5, z: 6, block: 3, seq: 1, author: 'b' });
    applyEdit(room, { x: 1, y: 2, z: 3, block: 17, seq: 2, author: 'a' });
    applyEdit(room, { x: 1, y: 2, z: 3, block: 99, seq: 1, author: 'b' }); // stale
    expect(room.edits).toHaveLength(2);
    expect(room.edits[0].block).toBe(17);
  });

  it('only accepts enemy snapshots from the host', () => {
    const room = createRoom();
    applyPlayer(room, player('amy')); // host
    applyPlayer(room, player('zoe'));
    applyEnemies(room, 'zoe', [enemy('bad')]);
    expect(Object.keys(room.enemies)).toHaveLength(0);
    applyEnemies(room, 'amy', [enemy('good')]);
    expect(room.enemies.good.kind).toBe('stalker');
  });
});

describe('protocol validation', () => {
  it('rejects invalid player state before it can enter the room', () => {
    const room = createRoom();
    expect(isPlayerState(player('a'))).toBe(true);
    expect(isPlayerState({ ...player('a'), x: Number.NaN })).toBe(false);
    expect(isPlayerState({ ...player('a'), id: '' })).toBe(false);
    applyPlayer(room, { ...player('a'), x: Infinity });
    expect(Object.keys(room.players)).toHaveLength(0);
  });

  it('round-trips messages and drops malformed JSON', () => {
    const msg = { t: 'player' as const, state: player('a') };
    expect(decode(encode(msg))).toEqual(msg);
    expect(decode('{oops')).toBeNull();
    expect(decode('{"t":"edit","edit":{"x":0.5}}')).toBeNull();
    expect(decode('{"t":"unknown"}')).toBeNull();
  });
});
