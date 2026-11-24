import { describe, expect, it } from 'vitest';
import { createRelay } from '../relay/server.mjs';

function socket() {
  const sent = [];
  return { sent, send(text) { sent.push(JSON.parse(text)); }, last() { return sent[sent.length - 1]; } };
}
const player = (id) => ({ t: 'player', state: { id, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100 } });
const join = (relay, id, name = 'test') => {
  const s = socket();
  relay.connect(s, name, id);
  return s;
};

describe('relay rooms', () => {
  it('sends a sync snapshot on join and caps rooms at six clients', () => {
    const relay = createRelay();
    const first = join(relay, 'a');
    expect(first.sent.some(m => m.t === 'sync')).toBe(true);
    for (const id of ['b', 'c', 'd', 'e', 'f']) join(relay, id);
    const extra = socket();
    expect(relay.connect(extra, 'test', 'g')).toBe(false);
    expect(extra.last().t).toBe('full');
  });

  it('fans player movement out to everyone except the sender', () => {
    const relay = createRelay();
    const a = join(relay, 'a'), b = join(relay, 'b');
    a.sent.length = 0; b.sent.length = 0;
    relay.receive(a, JSON.stringify(player('a')));
    expect(a.sent).toHaveLength(0);
    expect(b.last()).toEqual(player('a'));
    expect(relay.rooms.get('test').players.a.x).toBe(0);
  });

  it('forwards edits and keeps only the newest edit per voxel', () => {
    const relay = createRelay();
    const a = join(relay, 'a');
    const edit = (seq, block) => JSON.stringify({ t: 'edit', edit: { x: 1, y: 2, z: 3, block, seq, author: 'a' } });
    relay.receive(a, edit(1, 2));
    relay.receive(a, edit(3, 17));
    relay.receive(a, edit(2, 99)); // stale, ignored
    expect(relay.rooms.get('test').edits).toHaveLength(1);
    expect(relay.rooms.get('test').edits[0].block).toBe(17);
  });

  it('accepts enemy snapshots only from the host', () => {
    const relay = createRelay();
    const a = join(relay, 'a'), b = join(relay, 'b');
    relay.receive(a, JSON.stringify(player('a')));
    const enemies = [{ id: 'e1', kind: 'stalker', x: 1, y: 2, z: 3, yaw: 0, hp: 10 }];
    relay.receive(b, JSON.stringify({ t: 'enemies', from: 'b', enemies }));
    expect(Object.keys(relay.rooms.get('test').enemies)).toHaveLength(0);
    relay.receive(a, JSON.stringify({ t: 'enemies', from: 'a', enemies }));
    expect(relay.rooms.get('test').enemies.e1.kind).toBe('stalker');
    expect(b.last().t).toBe('enemies');
  });

  it('removes a departing player and broadcasts the leave', () => {
    const relay = createRelay();
    const a = join(relay, 'a'), b = join(relay, 'b');
    relay.receive(a, JSON.stringify(player('a')));
    b.sent.length = 0;
    relay.disconnect(a);
    expect(relay.rooms.get('test').players.a).toBeUndefined();
    expect(b.last()).toEqual({ t: 'leave', id: 'a' });
  });
});
