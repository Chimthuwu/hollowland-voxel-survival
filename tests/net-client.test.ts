import { describe, expect, it } from 'vitest';
import { NetClient, type SocketLike } from '../src/net/client';
import { encode } from '../src/net/protocol';

function fakeSocket() {
  const sent: unknown[] = [];
  const listeners: Array<(e: { data: unknown }) => void> = [];
  const socket: SocketLike = {
    send: text => sent.push(JSON.parse(text)),
    addEventListener: (_type, fn) => listeners.push(fn),
    close: () => sent.push({ closed: true }),
  };
  return { socket, sent, deliver: (text: string) => listeners.forEach(fn => fn({ data: text })) };
}

describe('network client', () => {
  it('tracks peers, edits and departures from relay messages', () => {
    const { socket, deliver } = fakeSocket();
    const edits: number[] = [];
    const client = new NetClient(socket, 'a', { onEdit: e => edits.push(e.block) });
    deliver(encode({ t: 'joined', id: 'a', room: 'test' }));
    deliver(encode({ t: 'player', state: { id: 'b', x: 1, y: 2, z: 3, yaw: 0, pitch: 0, health: 100 } }));
    deliver(encode({ t: 'edit', edit: { x: 0, y: 1, z: 0, block: 17, seq: 1, author: 'b' } }));
    expect(Object.keys(client.room.players)).toEqual(['b']);
    expect(edits).toEqual([17]);
    deliver(encode({ t: 'leave', id: 'b' }));
    expect(Object.keys(client.room.players)).toEqual([]);
  });

  it('only the host may publish enemy snapshots', () => {
    const a = fakeSocket(), b = fakeSocket();
    const ca = new NetClient(a.socket, 'a'), cb = new NetClient(b.socket, 'b');
    a.deliver(encode({ t: 'joined', id: 'a', room: 'r' }));
    b.deliver(encode({ t: 'joined', id: 'b', room: 'r' }));
    for (const c of [ca, cb]) c.sendPlayer({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100 });
    for (const [from, c] of [[a, ca], [b, cb]] as const) {
      from.deliver(encode({ t: 'player', state: { id: 'a', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100 } }));
      from.deliver(encode({ t: 'player', state: { id: 'b', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100 } }));
    }
    const enemies = [{ id: 'e', kind: 'stalker', x: 0, y: 0, z: 0, yaw: 0, hp: 5 }];
    expect(ca.isHost).toBe(true); // lowest id across both players
    expect(cb.isHost).toBe(false);
    expect(cb.sendEnemies(enemies)).toBe(false);
    expect(ca.sendEnemies(enemies)).toBe(true);
    expect(a.sent.some(m => (m as { t: string }).t === 'enemies')).toBe(true);
  });

  it('numbers edits monotonically and closes on leave', () => {
    const { socket, sent } = fakeSocket();
    const client = new NetClient(socket, 'a');
    client.sendEdit({ x: 1, y: 2, z: 3, block: 4 });
    client.sendEdit({ x: 1, y: 2, z: 3, block: 5 });
    expect(sent[0]).toMatchObject({ t: 'edit', edit: { seq: 1, author: 'a' } });
    expect(sent[1]).toMatchObject({ t: 'edit', edit: { seq: 2, author: 'a' } });
    client.leave();
    expect(sent[2]).toEqual({ t: 'leave', id: 'a' });
    expect(sent[3]).toEqual({ closed: true });
    expect(client.connected).toBe(false);
  });
});
