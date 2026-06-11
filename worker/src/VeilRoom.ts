/**
 * worker/src/VeilRoom.ts
 * The Durable Object behind one campaign (one room code = one VeilRoom).
 * Responsibilities:
 *  - live WebSocket sessions via the hibernation API (acceptWebSocket +
 *    webSocketMessage/Close/Error handlers; identity survives hibernation in
 *    each socket's serialized attachment),
 *  - a 10Hz tick that broadcasts player positions and drives choice deadlines
 *    and random story events,
 *  - persistence of campaign / players / journal in DO storage (debounced
 *    ~2s, flushed when the last socket closes),
 *  - delegating all narrative decisions to the StoryDirector.
 */

import { isArchetypeId } from '../../shared/archetypes';
import type { ArchetypeId } from '../../shared/archetypes';
import {
  isEmoteId,
  isLocationId,
  MAX_CHAT_LEN,
  MAX_NAME_LEN,
  MAX_PLAYERS,
  NET_TICK_MS,
  PROTOCOL_VERSION,
  STARTING_LOCATION,
} from '../../shared/constants';
import type { AnimState, LocationId } from '../../shared/constants';
import { isClientMsgShape } from '../../shared/protocol';
import type {
  ClientMsg,
  ItemStack,
  JournalEntry,
  PlayerId,
  PlayerInfo,
  PlayerStats,
  PlayerTick,
  ServerErrorCode,
  ServerMsg,
  Snapshot,
  Vec3,
} from '../../shared/protocol';
import type { ItemDef } from '../../shared/story';
import { createDefaultCampaign, shortId, StoryDirector } from './StoryDirector';
import type { CampaignState } from './StoryDirector';
import type { Env } from './index';

// ── Local types ──────────────────────────────────────────────────────────────

/** Persistent per-player record, keyed by the client's identity token. */
interface StoredPlayer {
  id: PlayerId;
  name: string;
  archetype: ArchetypeId;
  location: LocationId;
  /**
   * Last known position/yaw, riding along with the debounced persist. Wakes
   * rebuild the live map from this — without it, an idle player would be
   * broadcast at [0,0,0] after a DO restart, because clients suppress
   * unchanged move sends. Optional: records from older campaigns lack it.
   */
  pos?: Vec3;
  yaw?: number;
  stats: PlayerStats;
  inventory: ItemStack[];
  joinedAt: number;
}

/** In-memory per-socket session (rebuilt from attachments after a wake). */
interface Session {
  playerId: PlayerId | null;
  token: string | null;
}

/** Hibernation attachment shape (must stay JSON/structured-clone friendly). */
interface SocketAttachment {
  playerId: PlayerId;
  token: string;
}

/** Client-authoritative live transform, updated by `move` messages. */
interface LiveState {
  p: Vec3;
  ry: number;
  a: AnimState;
  loc: LocationId;
}

const PERSIST_DEBOUNCE_MS = 2_000;
/** Close code used when a newer socket replaces an older one (same token). */
const CLOSE_REPLACED = 4000;
const CLOSE_PROTOCOL_MISMATCH = 4001;
const CLOSE_ROOM_FULL = 4002;

const ANIM_STATES: readonly AnimState[] = ['idle', 'walk', 'run'];

const NOTHING_STIRS = 'The Veil hums softly, but nothing more stirs here.';

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => Number.isFinite(n));
}

/** Strip control characters, trim, and cap length. */
function sanitizeName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME_LEN)
    .trim();
}

// ── The Durable Object ───────────────────────────────────────────────────────

export class VeilRoom {
  private readonly state: DurableObjectState;

  // Persisted state (storage keys: "campaign", "players", "journal", "roomCode").
  // The campaign object is mutated in place (never replaced) so the
  // StoryDirector's getCampaign() reference stays valid across loads.
  private readonly campaign: CampaignState = createDefaultCampaign();
  private players: Record<string, StoredPlayer> = {};
  private journal: JournalEntry[] = [];
  private roomCode = '';

  // Transient in-memory state. The tick interval pins the DO in memory while
  // anyone is connected, so these survive a whole play session; they are
  // rebuilt with safe defaults after a genuine hibernation/wake.
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly live = new Map<PlayerId, LiveState>();
  /** Crew-ping rate limiting (in-memory; resets on wake, which is fine). */
  private readonly lastMarkerAt = new Map<PlayerId, number>();
  private focusHolderId: PlayerId | null = null;
  private tickHandle: number | null = null;
  private persistHandle: number | null = null;

  private readonly director: StoryDirector;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;

    // Narrow host interface: the director mutates the campaign object
    // directly and uses these callbacks for sockets/players/journal.
    this.director = new StoryDirector({
      getCampaign: () => this.campaign,
      broadcast: (msg) => this.broadcast(msg),
      sendTo: (pid, msg) => this.sendTo(pid, msg),
      getOnlinePlayerIds: () => this.onlinePlayerIds(),
      getAllPlayerIds: () => Object.values(this.players).map((p) => p.id),
      getPlayerName: (pid) => this.recordById(pid)?.name ?? 'A Veilwalker',
      getPlayerLocation: (pid) =>
        this.live.get(pid)?.loc ?? this.recordById(pid)?.location ?? null,
      addJournal: (entry) => {
        this.journal.push(entry);
        this.schedulePersist();
      },
      giveItem: (pid, item) => this.giveItem(pid, item),
      bumpBeatsWitnessed: (pids) => this.bumpBeatsWitnessed(pids),
      persist: () => this.schedulePersist(),
    });

    // Load persisted state before any request/message is delivered, and
    // rebuild the session map from hibernated sockets' attachments.
    this.state.blockConcurrencyWhile(async () => {
      const [campaign, players, journal, roomCode] = await Promise.all([
        this.state.storage.get<CampaignState>('campaign'),
        this.state.storage.get<Record<string, StoredPlayer>>('players'),
        this.state.storage.get<JournalEntry[]>('journal'),
        this.state.storage.get<string>('roomCode'),
      ]);
      // Merge over defaults so fields added in newer versions keep defaults.
      if (campaign) Object.assign(this.campaign, campaign);
      if (players) this.players = players;
      if (journal) this.journal = journal;
      if (roomCode) this.roomCode = roomCode;

      // Lazily rebuild sessions after a wake: identity lives in each
      // socket's attachment; positions reset until the next move arrives.
      for (const ws of this.state.getWebSockets()) {
        const session = this.sessionFromAttachment(ws);
        this.sessions.set(ws, session);
        if (session.playerId) {
          const rec = this.recordById(session.playerId);
          if (rec && !this.live.has(session.playerId)) {
            // Seed from the persisted last-known position: idle clients
            // suppress unchanged move sends, so a [0,0,0] placeholder here
            // would be broadcast until the player next moved.
            this.live.set(session.playerId, {
              p: rec.pos ? [...rec.pos] : [0, 0, 0],
              ry: rec.yaw ?? 0,
              a: 'idle',
              loc: rec.location,
            });
          }
        }
      }
      if (this.sessions.size > 0) this.ensureTick();
    });
  }

  // ── HTTP entry (routed by worker/src/index.ts with the path preserved) ─────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/api\/room\/([A-Z0-9]+)\/(info|ws)$/.exec(url.pathname);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Remember our room code in memory (used in snapshots). Only the /ws path
    // persists it: /info probes happen for every typo'd or pre-join code, and
    // a storage write would permanently materialize a Durable Object per
    // probed code on what should be a read-only existence check.
    this.roomCode = match[1];

    if (match[2] === 'info') {
      const info = {
        exists: Object.keys(this.players).length > 0,
        players: this.onlinePlayerIds().length,
        act: this.campaign.act,
      };
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade handshake.
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade request.', { status: 426 });
    }
    // A real player is connecting: now persisting the room code is warranted
    // (it must survive hibernation wakes that arrive via webSocketMessage).
    void this.state.storage.put('roomCode', this.roomCode);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Hibernation API: the runtime owns the socket and delivers events to the
    // webSocketMessage/Close/Error handlers, waking this DO if needed.
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { playerId: null, token: null });
    this.ensureTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket hibernation handlers ─────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureTick(); // restart the tick after a hibernation wake
    let session = this.sessions.get(ws);
    if (!session) {
      // Defensive: socket not seen by this instance yet (shouldn't happen
      // since the constructor rebuilds the map, but never trust timing).
      session = this.sessionFromAttachment(ws);
      this.sessions.set(ws, session);
    }

    if (typeof message !== 'string') {
      this.sendError(ws, 'bad-message', 'Binary frames are not supported.');
      return;
    }
    let msg: ClientMsg;
    try {
      const parsed: unknown = JSON.parse(message);
      if (!isClientMsgShape(parsed)) {
        this.sendError(ws, 'bad-message', 'Unrecognized message shape.');
        return;
      }
      msg = parsed;
    } catch {
      this.sendError(ws, 'bad-message', 'Message is not valid JSON.');
      return;
    }

    // Handlers must never throw — one bad message must not kill the room.
    try {
      this.dispatch(ws, session, msg);
    } catch (err) {
      console.error('[VeilRoom] handler error', err);
      this.sendError(ws, 'unknown', 'Internal error while handling the message.');
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.cleanupSocket(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.cleanupSocket(ws);
  }

  // ── Message dispatch ───────────────────────────────────────────────────────

  private dispatch(ws: WebSocket, session: Session, msg: ClientMsg): void {
    // The first message on every socket must be a join.
    if (!session.playerId) {
      if (msg.t === 'join') this.handleJoin(ws, session, msg);
      else this.sendError(ws, 'bad-message', 'The first message must be a join.');
      return;
    }
    const rec = this.recordById(session.playerId);
    if (!rec) {
      this.sendError(ws, 'unknown', 'Player record missing; please rejoin.');
      return;
    }

    switch (msg.t) {
      case 'join':
        this.sendError(ws, 'bad-message', 'Already joined.');
        break;

      case 'move': {
        // Client-authoritative position; validate finite numbers only.
        if (!isVec3(msg.p) || !Number.isFinite(msg.ry)) return;
        const anim: AnimState = ANIM_STATES.includes(msg.a) ? msg.a : 'idle';
        const cur = this.live.get(rec.id);
        this.live.set(rec.id, {
          p: [msg.p[0], msg.p[1], msg.p[2]],
          ry: msg.ry,
          a: anim,
          loc: cur?.loc ?? rec.location,
        });
        // Shadow onto the persisted record (in-memory mutation; the debounced
        // persist picks it up) so positions survive DO restarts.
        rec.pos = [msg.p[0], msg.p[1], msg.p[2]];
        rec.yaw = msg.ry;
        break;
      }

      case 'chat': {
        if (typeof msg.text !== 'string') return;
        const text = msg.text.trim().slice(0, MAX_CHAT_LEN);
        if (!text) return;
        this.broadcast({ t: 'chat', from: rec.id, name: rec.name, text });
        break;
      }

      case 'emote': {
        if (!isEmoteId(msg.emote)) {
          this.sendError(ws, 'bad-message', 'Unknown emote.');
          return;
        }
        this.broadcast({ t: 'emote', from: rec.id, name: rec.name, emote: msg.emote });
        break;
      }

      case 'enterLocation': {
        if (!isLocationId(msg.location)) {
          this.sendError(ws, 'bad-message', 'Unknown location.');
          return;
        }
        if (!this.campaign.unlocked.includes(msg.location)) {
          this.sendTo(rec.id, {
            t: 'travelDenied',
            location: msg.location,
            reason: 'That way is still sealed behind the Veil.',
          });
          return;
        }
        rec.location = msg.location;
        const live = this.live.get(rec.id);
        if (live) live.loc = msg.location;
        this.broadcast({ t: 'playerLoc', playerId: rec.id, location: msg.location });
        this.schedulePersist();
        this.director.onEnterLocation(rec.id, msg.location);
        break;
      }

      case 'interact': {
        if (typeof msg.objectId !== 'string' || !msg.objectId) {
          this.sendError(ws, 'bad-message', 'Missing objectId.');
          return;
        }
        rec.stats.interactions++;
        this.broadcast({ t: 'stats', playerId: rec.id, stats: rec.stats });
        this.schedulePersist();
        const stirred = this.director.onInteract(rec.id, msg.objectId);
        if (!stirred) {
          this.sendTo(rec.id, { t: 'denied', objectId: msg.objectId, reason: NOTHING_STIRS });
        }
        break;
      }

      case 'vote': {
        if (typeof msg.choiceId !== 'string' || typeof msg.optionId !== 'string') return;
        const result = this.director.onVote(rec.id, msg.choiceId, msg.optionId);
        if (result === 'first') {
          rec.stats.votesCast++;
          this.broadcast({ t: 'stats', playerId: rec.id, stats: rec.stats });
          this.schedulePersist();
        }
        break;
      }

      case 'marker': {
        // Crew ping: ephemeral, broadcast to everyone (sender included, so
        // their own ping renders identically). Light rate limit per player.
        if (!isVec3(msg.p)) return;
        const now = Date.now();
        const last = this.lastMarkerAt.get(rec.id) ?? 0;
        if (now - last < 1500) return;
        this.lastMarkerAt.set(rec.id, now);
        this.broadcast({
          t: 'marker',
          from: rec.id,
          name: rec.name,
          p: [msg.p[0], msg.p[1], msg.p[2]],
          loc: this.live.get(rec.id)?.loc ?? rec.location,
        });
        return;
      }

      case 'focus': {
        if (msg.on) {
          // Grant only when free; a second anchor request while someone else
          // holds the scene is silently ignored (the client mirrors state).
          if (this.focusHolderId === null) {
            this.focusHolderId = rec.id;
            this.broadcast({ t: 'focus', holderId: rec.id, holderName: rec.name });
            this.director.onFocusGranted(rec.id);
          }
        } else if (this.focusHolderId === rec.id) {
          this.focusHolderId = null;
          this.broadcast({ t: 'focus', holderId: null, holderName: null });
        }
        break;
      }

      case 'ping': {
        const ts = Number.isFinite(msg.ts) ? msg.ts : Date.now();
        this.send(ws, { t: 'pong', ts });
        break;
      }
    }
  }

  // ── Join flow ──────────────────────────────────────────────────────────────

  private handleJoin(
    ws: WebSocket,
    session: Session,
    msg: Extract<ClientMsg, { t: 'join' }>,
  ): void {
    const name = typeof msg.name === 'string' ? sanitizeName(msg.name) : '';
    if (!name) {
      this.sendError(ws, 'bad-message', 'A name is required.');
      return;
    }
    if (!isArchetypeId(msg.archetype)) {
      this.sendError(ws, 'bad-message', 'Unknown archetype.');
      return;
    }
    if (typeof msg.token !== 'string' || !msg.token) {
      this.sendError(ws, 'bad-message', 'A token is required.');
      return;
    }
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.sendError(
        ws,
        'protocol-mismatch',
        `Server speaks protocol v${PROTOCOL_VERSION}; please refresh the page.`,
      );
      ws.close(CLOSE_PROTOCOL_MISMATCH, 'protocol mismatch');
      return;
    }

    // Kick any existing live socket with the same token (one tab per token).
    // Remove from the session map first so its close handler won't broadcast
    // a 'left' for the player who is rejoining right now.
    for (const [otherWs, other] of this.sessions) {
      if (other.token === msg.token && otherWs !== ws) {
        this.sessions.delete(otherWs);
        try {
          otherWs.close(CLOSE_REPLACED, 'Replaced by a newer session.');
        } catch {
          // already closing — fine
        }
      }
    }

    // Room capacity (checked after the kick so a rejoin never self-blocks).
    if (this.onlinePlayerIds().length >= MAX_PLAYERS) {
      this.sendError(ws, 'room-full', `This Veil already holds ${MAX_PLAYERS} walkers.`);
      ws.close(CLOSE_ROOM_FULL, 'room full');
      return;
    }

    // Known token -> restore the persistent record; otherwise create one.
    let rec = this.players[msg.token];
    if (rec) {
      rec.name = name;
      rec.archetype = msg.archetype;
    } else {
      rec = {
        id: shortId(),
        name,
        archetype: msg.archetype,
        location: STARTING_LOCATION,
        stats: { interactions: 0, votesCast: 0, beatsWitnessed: 0 },
        inventory: [],
        joinedAt: Date.now(),
      };
      this.players[msg.token] = rec;
    }

    session.playerId = rec.id;
    session.token = msg.token;
    // Identity must survive hibernation: stash it on the socket itself.
    const attachment: SocketAttachment = { playerId: rec.id, token: msg.token };
    ws.serializeAttachment(attachment);

    if (!this.live.has(rec.id)) {
      this.live.set(rec.id, { p: [0, 0, 0], ry: 0, a: 'idle', loc: rec.location });
    } else {
      const live = this.live.get(rec.id)!;
      live.loc = rec.location;
    }

    this.send(ws, { t: 'welcome', playerId: rec.id, snapshot: this.buildSnapshot(rec) });
    this.broadcastExcept(ws, { t: 'joined', player: this.toPlayerInfo(rec) });
    this.ensureTick();
    this.schedulePersist();
  }

  // ── Snapshot building ──────────────────────────────────────────────────────

  private buildSnapshot(you: StoredPlayer): Snapshot {
    const records = Object.values(this.players);
    const inventories: Record<PlayerId, ItemStack[]> = {};
    for (const rec of records) inventories[rec.id] = rec.inventory;
    return {
      protocolVersion: PROTOCOL_VERSION,
      roomCode: this.roomCode,
      you: this.toPlayerInfo(you),
      players: records.map((rec) => this.toPlayerInfo(rec)),
      flags: [...this.campaign.flags],
      unlocked: [...this.campaign.unlocked],
      journal: [...this.journal],
      relationships: { ...this.campaign.relationships },
      inventories,
      mood: this.campaign.mood,
      act: this.campaign.act,
      firedBeats: [...this.campaign.firedBeats],
      focusHolder: this.focusHolderId,
      activeChoice: this.director.getActiveChoiceState(),
      endingId: this.campaign.endingId,
      ending: this.campaign.endingId
        ? this.director.buildEndingPayload(this.campaign.endingId)
        : null,
    };
  }

  private toPlayerInfo(rec: StoredPlayer): PlayerInfo {
    const live = this.live.get(rec.id);
    return {
      id: rec.id,
      name: rec.name,
      archetype: rec.archetype,
      location: rec.location,
      pos: live ? [...live.p] : rec.pos ? [...rec.pos] : [0, 0, 0],
      yaw: live?.ry ?? 0,
      online: this.isOnline(rec.id),
      stats: rec.stats,
      joinedAt: rec.joinedAt,
    };
  }

  // ── Tick (10Hz state broadcast + story timers) ─────────────────────────────

  private ensureTick(): void {
    if (this.tickHandle !== null || this.sessions.size === 0) return;
    // NOTE: a live interval intentionally PINS this Durable Object in memory
    // (prevents hibernation/eviction) for as long as anyone is connected —
    // the 10Hz broadcast, vote deadlines and delayed-beat timers all rely on
    // wall-clock continuity. It is cleared when the last socket closes so an
    // idle room can hibernate and costs nothing.
    this.tickHandle = setInterval(() => this.tick(), NET_TICK_MS);
  }

  private stopTick(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private tick(): void {
    if (this.sessions.size === 0) {
      this.stopTick();
      return;
    }
    const players: PlayerTick[] = [];
    for (const [pid, live] of this.live) {
      if (!this.isOnline(pid)) continue;
      players.push({ id: pid, p: live.p, ry: live.ry, a: live.a, loc: live.loc });
    }
    this.broadcast({ t: 'state', players });
    const now = Date.now();
    this.director.checkDeadlines(now);
    this.director.maybeRollRandomEvent(now);
  }

  // ── Session bookkeeping ────────────────────────────────────────────────────

  private sessionFromAttachment(ws: WebSocket): Session {
    try {
      // deserializeAttachment is `any` by the runtime's nature; guard fields.
      const att = ws.deserializeAttachment() as Partial<SocketAttachment> | null;
      if (att && typeof att.playerId === 'string' && typeof att.token === 'string') {
        return { playerId: att.playerId, token: att.token };
      }
    } catch {
      // No attachment yet — socket never completed a join.
    }
    return { playerId: null, token: null };
  }

  private cleanupSocket(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (session?.playerId && !this.isOnline(session.playerId)) {
      const pid = session.playerId;
      this.live.delete(pid);
      // Anchoring releases with its holder.
      if (this.focusHolderId === pid) {
        this.focusHolderId = null;
        this.broadcast({ t: 'focus', holderId: null, holderName: null });
      }
      const name = this.recordById(pid)?.name ?? 'A Veilwalker';
      this.broadcast({ t: 'left', playerId: pid, name });
    }

    if (this.sessions.size === 0) {
      // Last socket gone: stop pinning the DO and flush state immediately so
      // nothing is lost if the runtime evicts us before the debounce fires.
      this.stopTick();
      this.flushPersist();
    } else {
      this.schedulePersist();
    }
  }

  private onlinePlayerIds(): PlayerId[] {
    const ids = new Set<PlayerId>();
    for (const session of this.sessions.values()) {
      if (session.playerId) ids.add(session.playerId);
    }
    return [...ids];
  }

  private isOnline(playerId: PlayerId): boolean {
    for (const session of this.sessions.values()) {
      if (session.playerId === playerId) return true;
    }
    return false;
  }

  private recordById(playerId: PlayerId): StoredPlayer | undefined {
    for (const rec of Object.values(this.players)) {
      if (rec.id === playerId) return rec;
    }
    return undefined;
  }

  // ── Director host helpers ──────────────────────────────────────────────────

  private giveItem(playerId: PlayerId, item: ItemDef): ItemStack[] {
    const rec = this.recordById(playerId);
    if (!rec) return [];
    const existing = rec.inventory.find((stack) => stack.id === item.id);
    if (existing) existing.count += 1;
    else {
      rec.inventory.push({
        id: item.id,
        name: item.name,
        description: item.description,
        icon: item.icon,
        count: 1,
      });
    }
    this.schedulePersist();
    return rec.inventory;
  }

  private bumpBeatsWitnessed(playerIds: PlayerId[]): void {
    for (const pid of playerIds) {
      const rec = this.recordById(pid);
      if (!rec) continue;
      rec.stats.beatsWitnessed++;
      this.broadcast({ t: 'stats', playerId: pid, stats: rec.stats });
    }
    this.schedulePersist();
  }

  // ── Send helpers ───────────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already gone; close/error handler will clean it up.
    }
  }

  private sendError(ws: WebSocket, code: ServerErrorCode, message: string): void {
    this.send(ws, { t: 'error', code, message });
  }

  /** Send to every JOINED session (pre-join sockets get nothing). */
  private broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const [ws, session] of this.sessions) {
      if (!session.playerId) continue;
      try {
        ws.send(payload);
      } catch {
        // Dead socket; the close handler will reap it.
      }
    }
  }

  private broadcastExcept(except: WebSocket, msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const [ws, session] of this.sessions) {
      if (ws === except || !session.playerId) continue;
      try {
        ws.send(payload);
      } catch {
        // Dead socket; the close handler will reap it.
      }
    }
  }

  private sendTo(playerId: PlayerId, msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const [ws, session] of this.sessions) {
      if (session.playerId !== playerId) continue;
      try {
        ws.send(payload);
      } catch {
        // Dead socket; the close handler will reap it.
      }
    }
  }

  // ── Persistence (debounced) ────────────────────────────────────────────────

  private schedulePersist(): void {
    if (this.persistHandle !== null) return;
    this.persistHandle = setTimeout(() => {
      this.persistHandle = null;
      void this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  private flushPersist(): void {
    if (this.persistHandle !== null) {
      clearTimeout(this.persistHandle);
      this.persistHandle = null;
    }
    void this.persistNow();
  }

  private async persistNow(): Promise<void> {
    try {
      await this.state.storage.put({
        campaign: this.campaign,
        players: this.players,
        journal: this.journal,
      });
    } catch (err) {
      console.error('[VeilRoom] persist failed', err);
    }
  }
}
