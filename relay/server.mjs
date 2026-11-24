// Minimal room relay for Hollowland. Rooms are capped at six clients; the
// lowest client id is host and is the only one whose enemy snapshots are
// forwarded. Terrain is never sent — clients regenerate it from the seed.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const MAX_PLAYERS = 6;

export function createRelay() {
  /** @type {Map<string, {clients: Map<object, string>, players: Record<string, object>, edits: object[], enemies: Record<string, object>}>} */
  const rooms = new Map();

  const roomFor = (name) => {
    let room = rooms.get(name);
    if (!room) { room = { clients: new Map(), players: {}, edits: [], enemies: {} }; rooms.set(name, room); }
    return room;
  };
  const hostOf = (room) => Object.keys(room.players).sort()[0] ?? null;
  const send = (socket, msg) => { try { socket.send(JSON.stringify(msg)); } catch { /* dead socket */ } };
  const broadcast = (room, msg, except) => {
    for (const socket of room.clients.keys()) if (socket !== except) send(socket, msg);
  };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const validPlayer = (p) => p && typeof p === 'object' && typeof p.id === 'string'
    && finite(p.x) && finite(p.y) && finite(p.z) && finite(p.yaw) && finite(p.pitch) && finite(p.health);
  const validEdit = (e) => e && typeof e === 'object'
    && Number.isInteger(e.x) && Number.isInteger(e.y) && Number.isInteger(e.z)
    && Number.isInteger(e.block) && finite(e.seq) && typeof e.author === 'string';

  function connect(socket, name, id) {
    const room = roomFor(name);
    if (room.clients.has(socket)) return false;
    if (room.clients.size >= MAX_PLAYERS) { send(socket, { t: 'full' }); return false; }
    const clientId = typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : randomUUID();
    room.clients.set(socket, clientId);
    send(socket, { t: 'joined', id: clientId, room: name });
    send(socket, { t: 'sync', room: { players: room.players, edits: room.edits, enemies: room.enemies } });
    return true;
  }

  function receive(socket, raw) {
    let room;
    for (const candidate of rooms.values()) if (candidate.clients.has(socket)) { room = candidate; break; }
    if (!room) return;
    const id = room.clients.get(socket);
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'player':
        if (!validPlayer(msg.state) || msg.state.id !== id) return;
        room.players[id] = msg.state;
        broadcast(room, { t: 'player', state: msg.state }, socket);
        break;
      case 'leave':
        disconnect(socket);
        break;
      case 'edit': {
        if (!validEdit(msg.edit)) return;
        const e = msg.edit;
        const at = room.edits.findIndex(x => x.x === e.x && x.y === e.y && x.z === e.z);
        if (at >= 0) { if (e.seq >= room.edits[at].seq) room.edits[at] = e; }
        else { room.edits.push(e); if (room.edits.length > 4096) room.edits.shift(); }
        broadcast(room, { t: 'edit', edit: e }, socket);
        break;
      }
      case 'enemies':
        if (id !== hostOf(room) || !Array.isArray(msg.enemies)) return;
        room.enemies = {};
        for (const enemy of msg.enemies.slice(0, 64)) {
          if (enemy && typeof enemy.id === 'string' && finite(enemy.x) && finite(enemy.y) && finite(enemy.z))
            room.enemies[enemy.id] = enemy;
        }
        broadcast(room, { t: 'enemies', from: id, enemies: Object.values(room.enemies) }, socket);
        break;
      default:
        break;
    }
  }

  function disconnect(socket) {
    for (const [name, room] of rooms) {
      const id = room.clients.get(socket);
      if (id === undefined) continue;
      room.clients.delete(socket);
      delete room.players[id];
      broadcast(room, { t: 'leave', id });
      if (room.clients.size === 0) rooms.delete(name);
      return;
    }
  }

  return { rooms, connect, receive, disconnect, hostOf: (name) => hostOf(roomFor(name)) };
}

export function startRelay({ port = Number(process.env.PORT || 8787), host = '0.0.0.0' } = {}) {
  const relay = createRelay();
  const server = createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }
    else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const room = (url.searchParams.get('room') || 'lobby').slice(0, 64);
    const id = url.searchParams.get('id') || '';
    if (!relay.connect(ws, room, id)) { ws.close(); return; }
    ws.on('message', data => relay.receive(ws, data.toString()));
    ws.on('close', () => relay.disconnect(ws));
    ws.on('error', () => relay.disconnect(ws));
  });
  server.listen(port, host);
  return { server, wss, relay };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = startRelay();
  started.server.once('listening', () => {
    const address = started.server.address();
    console.log(`Hollowland relay listening on ${address && typeof address === 'object' ? address.port : 'unknown'}`);
  });
}
