import {
  applyEdit, applyEnemies, applyPlayer, createRoom, decode, encode, hostId, removePlayer,
  type EnemyState, type Message, type PlayerState, type RoomState, type WorldEdit,
} from './protocol';

export { hostId };

/** The slice of WebSocket the client needs — easy to fake in tests. */
export interface SocketLike {
  send(data: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface NetEvents {
  onEdit?: (edit: WorldEdit) => void;
  onJoin?: (id: string, room: string) => void;
  onFull?: () => void;
}

/**
 * Browser-side room client. Maintains the authoritative room snapshot from
 * relay messages, sends this player's state and block edits, and lets only the
 * host publish enemy snapshots. No terrain data crosses the wire.
 */
export class NetClient {
  readonly room: RoomState = createRoom();
  private seq = 0;
  private joined = false;

  constructor(
    private readonly socket: SocketLike,
    readonly id: string,
    private readonly events: NetEvents = {},
  ) {
    socket.addEventListener('message', event => {
      const msg = decode(String(event.data ?? ''));
      if (msg) this.receive(msg);
    });
  }

  get isHost(): boolean { return this.joined && hostId(this.room) === this.id; }
  get connected(): boolean { return this.joined; }

  private send(msg: Message): void {
    try { this.socket.send(encode(msg)); } catch { /* socket closed */ }
  }

  private receive(msg: Message): void {
    switch (msg.t) {
      case 'joined':
        this.joined = true;
        this.events.onJoin?.(msg.id, msg.room);
        break;
      case 'full':
        this.events.onFull?.();
        break;
      case 'player':
        applyPlayer(this.room, msg.state);
        break;
      case 'leave':
        removePlayer(this.room, msg.id);
        break;
      case 'edit':
        applyEdit(this.room, msg.edit);
        this.events.onEdit?.(msg.edit);
        break;
      case 'enemies':
        applyEnemies(this.room, msg.from, msg.enemies);
        break;
      case 'sync':
        for (const state of Object.values(msg.room.players ?? {})) applyPlayer(this.room, state);
        for (const edit of msg.room.edits ?? []) applyEdit(this.room, edit);
        applyEnemies(this.room, hostId(this.room) ?? '', Object.values(msg.room.enemies ?? {}));
        break;
    }
  }

  sendPlayer(state: Omit<PlayerState, 'id'>): void {
    this.send({ t: 'player', state: { id: this.id, ...state } });
  }

  sendEdit(edit: Omit<WorldEdit, 'seq' | 'author'>): void {
    this.send({ t: 'edit', edit: { ...edit, seq: ++this.seq, author: this.id } });
  }

  sendEnemies(enemies: EnemyState[]): boolean {
    if (!this.isHost) return false;
    this.send({ t: 'enemies', from: this.id, enemies });
    return true;
  }

  leave(): void {
    this.send({ t: 'leave', id: this.id });
    this.socket.close();
    this.joined = false;
  }
}
