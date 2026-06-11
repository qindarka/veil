/**
 * src/net/NetworkClient.ts
 * WebSocket client for the VeilRoom Durable Object. Owns the connection
 * lifecycle (probe → join handshake → welcome), mirrors every ServerMsg into
 * ClientState and then emits the corresponding typed EventBus event, streams
 * the local avatar position at CLIENT_MOVE_MS, keeps the socket alive with
 * pings, reconnects with exponential backoff on unexpected closes, and offers
 * a fully offline solo-exploration mode with a synthetic snapshot.
 */

import {
  CLIENT_MOVE_MS,
  LOCATION_IDS,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  STARTING_LOCATION,
} from '../../shared/constants';
import type { AnimState } from '../../shared/constants';
import type {
  ClientMsg,
  PlayerId,
  PlayerInfo,
  ServerMsg,
  Snapshot,
  Vec3,
} from '../../shared/protocol';
import type {
  ConnectOptions,
  GameContext,
  INetworkClient,
  NetStatus,
} from '../types';

/** How long the /info reachability probe may take before we declare the worker unreachable. */
const INFO_TIMEOUT_MS = 4000;
/** How long we wait for the welcome ServerMsg after sending join. */
const WELCOME_TIMEOUT_MS = 5000;
/** Reconnect backoff schedule; length = max attempts. */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 8000] as const;
/** Don't resend an unchanged position: 1 cm squared. */
const MOVE_EPSILON_SQ = 0.0001;
const YAW_EPSILON = 0.01;

interface LastMove {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: AnimState;
}

/** Round to millimeters to keep move payloads short. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export class NetworkClient implements INetworkClient {
  private ctx!: GameContext;

  private socket: WebSocket | null = null;
  private _status: NetStatus = 'idle';
  private offline = false;
  /** True while a close was requested locally (dispose / socket swap) — suppresses reconnect. */
  private closedByUs = false;

  /** Options of the last connect(), reused verbatim by the reconnect handshake. */
  private connectOpts: ConnectOptions | null = null;
  private pendingWelcome: { resolve: (s: Snapshot) => void; reject: (e: Error) => void } | null =
    null;
  private welcomeTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectTries = 0;

  // Movement / keepalive cadence accumulators (seconds).
  private moveAccum = 0;
  private pingAccum = 0;
  private lastMove: LastMove | null = null;
  /** Last measured round-trip time (ms) from ping/pong; for future HUD diagnostics. */
  private lastRttMs = 0;

  get status(): NetStatus {
    return this._status;
  }

  get offlineMode(): boolean {
    return this.offline;
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  async connect(opts: ConnectOptions): Promise<Snapshot> {
    this.connectOpts = opts;
    this.closedByUs = false;
    this.offline = false;
    this.reconnectTries = 0;
    this.clearReconnectTimer();
    this.setStatus('connecting');
    try {
      return await this.doConnect(opts);
    } catch (err) {
      // Back to idle so the caller (Game) can offer the offline fallback.
      this.setStatus('idle', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * One full handshake: reachability probe, socket open, join, await welcome.
   * Used by both connect() and each reconnect attempt; the fresh welcome
   * snapshot re-mirrors all campaign state either way.
   */
  private async doConnect(opts: ConnectOptions): Promise<Snapshot> {
    const base = opts.workerUrl.replace(/\/+$/, '');
    const code = encodeURIComponent(opts.roomCode);

    // Probe the room info endpoint first so an absent/unreachable worker
    // fails fast with a clear error instead of a hung WebSocket.
    await this.probeRoom(base, code);

    return new Promise<Snapshot>((resolve, reject) => {
      this.closeSocket(); // drop any stale socket; its close event is ignored
      const wsUrl = `${base.replace(/^http/i, 'ws')}/api/room/${code}/ws`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch (err) {
        reject(
          new Error(
            `Could not open a WebSocket to ${wsUrl} — ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        return;
      }
      this.socket = socket;
      this.pendingWelcome = { resolve, reject };
      this.welcomeTimer = window.setTimeout(() => {
        this.failHandshake(
          socket,
          new Error('The room did not answer the join request (no welcome within 5s).'),
        );
      }, WELCOME_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        if (socket !== this.socket) return;
        const join: ClientMsg = {
          t: 'join',
          name: opts.name,
          archetype: opts.archetype,
          token: opts.token,
          protocolVersion: PROTOCOL_VERSION,
        };
        socket.send(JSON.stringify(join));
      });

      socket.addEventListener('message', (ev) => {
        if (socket !== this.socket) return;
        let msg: ServerMsg;
        try {
          // Untrusted JSON off the wire; the switch below only touches fields
          // that exist on the matching ServerMsg variant.
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return; // ignore malformed frames
        }
        if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
        this.handleServerMsg(msg);
      });

      socket.addEventListener('close', (ev) => this.onSocketClose(socket, ev.code));
      // 'error' is always followed by 'close'; nothing extra to do here.
    });
  }

  /** GET /api/room/:code/info with a short timeout; throws a descriptive Error on failure. */
  private async probeRoom(base: string, code: string): Promise<void> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), INFO_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${base}/api/room/${code}/info`, { signal: ctrl.signal });
    } catch (err) {
      const detail =
        err instanceof DOMException && err.name === 'AbortError'
          ? `no answer within ${INFO_TIMEOUT_MS / 1000}s`
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Error(`The Veil server at ${base} is unreachable (${detail}).`);
    } finally {
      window.clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`The Veil server at ${base} answered HTTP ${res.status} for the room lookup.`);
    }
  }

  /** Abort an in-flight handshake: detach the socket so its close event is inert. */
  private failHandshake(socket: WebSocket, err: Error): void {
    if (this.welcomeTimer !== null) {
      window.clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
    const pending = this.pendingWelcome;
    this.pendingWelcome = null;
    if (this.socket === socket) this.socket = null;
    try {
      socket.close();
    } catch {
      // already closed
    }
    pending?.reject(err);
  }

  private onSocketClose(socket: WebSocket, code?: number): void {
    if (socket !== this.socket) return; // stale socket from a previous attempt
    this.socket = null;
    if (this.pendingWelcome) {
      // Closed mid-handshake: reject; a reconnect attempt's catch will reschedule.
      this.failHandshake(socket, new Error('The connection closed before the room answered.'));
      return;
    }
    if (this.closedByUs) return; // deliberate local close — no reconnect
    if (code === 4000) {
      // The server kicked this socket because the same identity token joined
      // from somewhere else. Reconnecting would just kick the other session
      // back and forth forever — stay down and tell the player.
      this.setStatus('offline');
      this.ctx.events.emit('ui:toast', {
        text: 'Your thread was taken up elsewhere — this window has gone quiet.',
        kind: 'warn',
      });
      return;
    }
    // Unexpected drop of an established connection: start the backoff loop.
    if (this._status !== 'reconnecting') {
      this.setStatus('reconnecting');
      this.ctx.events.emit('ui:toast', {
        text: 'The thread to the Veil slipped — reweaving…',
        kind: 'warn',
      });
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedByUs || !this.connectOpts) return;
    if (this.reconnectTries >= RECONNECT_BACKOFF_MS.length) {
      // Out of attempts: give up but stay in the world (read-only solo).
      this.setStatus('offline', 'reconnect failed');
      this.ctx.events.emit('ui:toast', {
        text: 'The thread could not be rewoven. The dream drifts on without the others.',
        kind: 'warn',
      });
      return;
    }
    const delay = RECONNECT_BACKOFF_MS[this.reconnectTries];
    this.reconnectTries += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUs || !this.connectOpts) return;
      // The server restores identity from the token; the fresh welcome
      // snapshot re-mirrors everything, so no extra resync step is needed.
      this.doConnect(this.connectOpts).catch(() => this.scheduleReconnect());
    }, delay);
  }

  // ── Server message handling: mirror into state FIRST, then emit ───────────

  private handleServerMsg(msg: ServerMsg): void {
    const { state, events } = this.ctx;
    switch (msg.t) {
      case 'welcome': {
        state.applySnapshot(msg.snapshot, msg.playerId);
        this.reconnectTries = 0;
        this.lastMove = null; // force a fresh move send on the next tick
        if (this.welcomeTimer !== null) {
          window.clearTimeout(this.welcomeTimer);
          this.welcomeTimer = null;
        }
        events.emit('net:welcome', { playerId: msg.playerId, snapshot: msg.snapshot });
        // Event-driven UI (focus letterbox, audio lowpass, story overlay
        // linger) re-syncs from explicit events, not from polling state — so
        // replay the snapshot's focus state. Covers both stale-focus after a
        // reconnect and joining while someone is anchoring.
        const holder = msg.snapshot.focusHolder;
        events.emit('focus:changed', {
          holderId: holder,
          holderName: holder ? (state.getPlayer(holder)?.name ?? null) : null,
          self: holder !== null && holder === msg.playerId,
        });
        // A finale that fired while this socket was down is replayed from the
        // snapshot so no one misses the payoff (EndingScreen dedupes by id).
        if (msg.snapshot.ending) {
          events.emit('story:ending', { ending: msg.snapshot.ending });
        }
        this.setStatus('connected');
        const pending = this.pendingWelcome;
        this.pendingWelcome = null;
        pending?.resolve(msg.snapshot);
        break;
      }
      case 'joined': {
        state.upsertPlayer(msg.player);
        events.emit('party:player-joined', { player: msg.player });
        break;
      }
      case 'left': {
        // Players persist in the campaign; "left" only means offline.
        const p = state.players.get(msg.playerId);
        if (p) p.online = false;
        events.emit('party:player-left', { playerId: msg.playerId, name: msg.name });
        break;
      }
      case 'state': {
        for (const tick of msg.players) {
          const p = state.players.get(tick.id);
          if (!p) continue; // tick may race a 'joined' broadcast
          p.pos = tick.p;
          p.yaw = tick.ry;
          p.location = tick.loc;
        }
        events.emit('net:tick', { players: msg.players });
        break;
      }
      case 'chat': {
        events.emit('chat:message', {
          from: msg.from,
          name: msg.name,
          text: msg.text,
          self: msg.from === state.playerId,
        });
        break;
      }
      case 'emote': {
        events.emit('chat:emote', {
          from: msg.from,
          name: msg.name,
          emote: msg.emote,
          self: msg.from === state.playerId,
        });
        break;
      }
      case 'story': {
        // Mirror the server's firedBeats record (idempotent for re-sent beats).
        state.firedBeats.add(msg.beat.id);
        events.emit('story:beat', { beat: msg.beat });
        break;
      }
      case 'choiceOpen': {
        state.activeChoice = {
          choice: msg.choice,
          endsAt: msg.endsAt,
          tally: {},
          votedIds: [],
        };
        events.emit('story:choice-open', { choice: msg.choice, endsAt: msg.endsAt });
        break;
      }
      case 'voteTally': {
        if (state.activeChoice && state.activeChoice.choice.id === msg.choiceId) {
          state.activeChoice.tally = msg.tally;
          state.activeChoice.votedIds = msg.votedIds;
        }
        events.emit('story:vote-tally', {
          choiceId: msg.choiceId,
          tally: msg.tally,
          votedIds: msg.votedIds,
        });
        break;
      }
      case 'choiceResult': {
        state.activeChoice = null;
        events.emit('story:choice-result', {
          choiceId: msg.choiceId,
          optionId: msg.optionId,
          optionLabel: msg.optionLabel,
        });
        break;
      }
      case 'flags': {
        state.flags = new Set(msg.flags);
        state.act = msg.act;
        events.emit('story:flags', { flags: msg.flags, act: msg.act });
        break;
      }
      case 'locations': {
        state.unlocked = [...msg.unlocked];
        events.emit('locations:unlocked', { unlocked: msg.unlocked });
        break;
      }
      case 'journal': {
        state.journal.push(msg.entry);
        events.emit('journal:entry', { entry: msg.entry });
        break;
      }
      case 'inventory': {
        state.inventories.set(msg.playerId, msg.items);
        events.emit('inventory:changed', { playerId: msg.playerId, items: msg.items });
        break;
      }
      case 'relationships': {
        state.relationships = { ...msg.relationships };
        events.emit('relationships:changed', { relationships: msg.relationships });
        break;
      }
      case 'playerLoc': {
        const p = state.players.get(msg.playerId);
        if (p) p.location = msg.location;
        events.emit('party:player-location', { playerId: msg.playerId, location: msg.location });
        break;
      }
      case 'stats': {
        const p = state.players.get(msg.playerId);
        if (p) p.stats = msg.stats;
        events.emit('party:stats', { playerId: msg.playerId, stats: msg.stats });
        break;
      }
      case 'focus': {
        state.focusHolder = msg.holderId;
        events.emit('focus:changed', {
          holderId: msg.holderId,
          holderName: msg.holderName,
          self: msg.holderId !== null && msg.holderId === state.playerId,
        });
        break;
      }
      case 'marker': {
        // Ephemeral crew ping — no state mirror, straight to listeners.
        events.emit('party:marker', {
          from: msg.from,
          name: msg.name,
          p: msg.p,
          location: msg.loc,
        });
        break;
      }
      case 'mood': {
        state.mood = msg.mood;
        events.emit('audio:mood', { mood: msg.mood });
        break;
      }
      case 'event': {
        events.emit('event:random', { event: msg.event });
        break;
      }
      case 'denied': {
        events.emit('net:denied', { reason: msg.reason, objectId: msg.objectId });
        // The Veil whispers its refusals rather than barking errors.
        events.emit('ui:toast', { text: msg.reason, kind: 'whisper' });
        break;
      }
      case 'travelDenied': {
        events.emit('ui:toast', { text: msg.reason, kind: 'warn' });
        break;
      }
      case 'ending': {
        state.endingId = msg.ending.id;
        events.emit('story:ending', { ending: msg.ending });
        break;
      }
      case 'pong': {
        this.lastRttMs = Date.now() - msg.ts;
        break;
      }
      case 'error': {
        const socket = this.socket;
        if (this.pendingWelcome && socket) {
          // Handshake-phase server errors (room-full, protocol-mismatch...)
          // reject connect() with the server's own descriptive message.
          this.failHandshake(socket, new Error(`${msg.message} (${msg.code})`));
          break;
        }
        events.emit('ui:toast', { text: msg.message, kind: 'warn' });
        events.emit('net:status', { status: this._status, detail: `${msg.code}: ${msg.message}` });
        break;
      }
      default: {
        // Forward-compat: unknown tags fall through to net:server-msg below.
        break;
      }
    }
    // Every server message, after state mirroring — for niche listeners.
    events.emit('net:server-msg', { msg });
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  send(msg: ClientMsg): void {
    if (this.offline) {
      // Offline solo mode has no StoryDirector: story beats, votes, chat and
      // interactions need the server, so everything is a no-op EXCEPT focus,
      // which loops back locally so focus mode (letterbox + anchoring) still
      // works for a lone explorer.
      if (msg.t === 'focus') {
        const holderId = msg.on ? this.ctx.state.playerId : null;
        this.ctx.state.focusHolder = holderId;
        this.ctx.events.emit('focus:changed', {
          holderId,
          holderName: holderId ? (this.ctx.state.you?.name ?? null) : null,
          self: holderId !== null && holderId === this.ctx.state.playerId,
        });
      }
      return;
    }
    // While the socket is not open (connecting/reconnecting/closed), drop silently.
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  update(dt: number, _elapsed: number): void {
    if (this.offline) return; // nothing to stream without a server
    this.moveAccum += dt;
    this.pingAccum += dt;
    if (this.moveAccum >= CLIENT_MOVE_MS / 1000) {
      this.moveAccum = 0;
      this.maybeSendMove();
    }
    if (this.pingAccum >= PING_INTERVAL_MS / 1000) {
      this.pingAccum = 0;
      this.send({ t: 'ping', ts: Date.now() });
    }
  }

  /** Sample the local player and send a move msg only when something changed. */
  private maybeSendMove(): void {
    if (this._status !== 'connected' || !this.ctx.state.you) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const player = this.ctx.player;
    const pos = player.position;
    const yaw = player.yaw;
    const anim = player.anim;
    const last = this.lastMove;
    if (last) {
      const dx = pos.x - last.x;
      const dy = pos.y - last.y;
      const dz = pos.z - last.z;
      const movedSq = dx * dx + dy * dy + dz * dz;
      if (movedSq <= MOVE_EPSILON_SQ && Math.abs(yaw - last.yaw) <= YAW_EPSILON && anim === last.anim) {
        return; // standing still — save the bandwidth
      }
    }
    const p: Vec3 = [round3(pos.x), round3(pos.y), round3(pos.z)];
    this.send({ t: 'move', p, ry: round3(yaw), a: anim });
    this.lastMove = { x: pos.x, y: pos.y, z: pos.z, yaw, anim };
  }

  // ── Offline solo mode ──────────────────────────────────────────────────────

  startOffline(opts: Pick<ConnectOptions, 'name' | 'archetype'>): Snapshot {
    this.closedByUs = true;
    this.clearReconnectTimer();
    this.closeSocket();

    const now = Date.now();
    const youId: PlayerId = 'offline-veilwalker';
    const you: PlayerInfo = {
      id: youId,
      name: opts.name,
      archetype: opts.archetype,
      location: STARTING_LOCATION,
      pos: [0, 0, 6],
      yaw: 0,
      online: true,
      stats: { interactions: 0, votesCast: 0, beatsWitnessed: 0 },
      joinedAt: now,
    };
    const snapshot: Snapshot = {
      protocolVersion: PROTOCOL_VERSION,
      roomCode: 'OFFLINE',
      you,
      players: [you],
      flags: [],
      // ALL locations are unlocked offline: with no StoryDirector to grant
      // unlocks, a solo explorer should still be able to sightsee everything.
      unlocked: [...LOCATION_IDS],
      journal: [
        {
          id: 'offline-welcome',
          at: now,
          category: 'system',
          title: 'A Quiet Dream',
          text:
            'You stepped through alone, and the Veil received you gently. Its harbors, groves and drowned halls lie open to a lone wanderer — walk them, and learn their light. The story itself sleeps until other Veilwalkers share the dream.',
          location: STARTING_LOCATION,
        },
      ],
      relationships: {},
      inventories: { [youId]: [] },
      mood: 'ambient',
      act: 1,
      firedBeats: [],
      focusHolder: null,
      activeChoice: null,
      endingId: null,
      ending: null,
    };

    this.ctx.state.applySnapshot(snapshot, youId);
    this.offline = true;
    this._status = 'offline';
    this.ctx.events.emit('net:welcome', { playerId: youId, snapshot });
    this.ctx.events.emit('net:status', { status: 'offline' });
    return snapshot;
  }

  // ── Helpers / teardown ─────────────────────────────────────────────────────

  private setStatus(status: NetStatus, detail?: string): void {
    this._status = status;
    if (detail !== undefined) this.ctx.events.emit('net:status', { status, detail });
    else this.ctx.events.emit('net:status', { status });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Detach the current socket (so its close event is ignored) and close it. */
  private closeSocket(): void {
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.close();
      } catch {
        // already closed/closing
      }
    }
  }

  dispose(): void {
    this.closedByUs = true;
    this.clearReconnectTimer();
    if (this.welcomeTimer !== null) {
      window.clearTimeout(this.welcomeTimer);
      this.welcomeTimer = null;
    }
    this.pendingWelcome = null;
    this.closeSocket();
  }

  /** Last measured ping round-trip (ms); 0 until the first pong. */
  get rttMs(): number {
    return this.lastRttMs;
  }
}
