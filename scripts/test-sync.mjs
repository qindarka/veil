#!/usr/bin/env node
/**
 * scripts/test-sync.mjs
 * Proof-of-sync smoke test: two headless WebSocket clients join the same
 * VeilRoom Durable Object and verify that one client's movement reaches the
 * other through the server's 10Hz state broadcast.
 *
 * Usage:
 *   node scripts/test-sync.mjs [--url http://127.0.0.1:8787]
 *
 * Requires Node >= 22 (global WebSocket). Zero dependencies.
 * Run `npx wrangler dev` (or `npm run dev:worker`) first.
 */

// Keep in sync with shared/constants.ts — this script can't import TypeScript.
const PROTOCOL_VERSION = 1;
// Unambiguous room-code alphabet (no 0/O/1/I), same as shared/constants.ts.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LEN = 6;

const RUN_TIMEOUT_MS = 15_000;
const STEP_TIMEOUT_MS = 5_000;
const STATE_TIMEOUT_MS = 3_000;
const EPSILON = 0.01;

// A distinctive position no spawn logic would ever produce by accident.
const TARGET_POS = [12.5, 0.75, -7.25];
const TARGET_RY = 1.25;

// ── Args ─────────────────────────────────────────────────────────────────────

function parseUrlArg() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) return args[i + 1];
    if (args[i].startsWith('--url=')) return args[i].slice('--url='.length);
  }
  return 'http://127.0.0.1:8787';
}

const baseUrl = parseUrlArg().replace(/\/+$/, '');

function randomRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

const roomCode = randomRoomCode();
const wsUrl = `${baseUrl.replace(/^http/i, 'ws')}/api/room/${roomCode}/ws`;

// ── Reporting helpers ────────────────────────────────────────────────────────

function pass(message) {
  console.log(`PASS ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

// Whole-run watchdog: if anything wedges, fail with a actionable hint.
const watchdog = setTimeout(() => {
  fail(
    `timed out after ${RUN_TIMEOUT_MS / 1000}s — is wrangler dev running at ${baseUrl}? ` +
      'Start it with: npx wrangler dev',
  );
}, RUN_TIMEOUT_MS);

// ── Tiny test client ─────────────────────────────────────────────────────────

class Client {
  constructor(label) {
    this.label = label;
    this.messages = []; // parsed but unclaimed server messages
    this.waiters = []; // { pred, resolve, reject, timer }
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => {
        reject(
          new Error(
            `${this.label}: WebSocket connection failed — is wrangler dev running at ${baseUrl}?`,
          ),
        );
      });
      this.ws.addEventListener('close', (ev) => {
        // Reject any pending waiters so the test fails fast on disconnects.
        for (const w of this.waiters.splice(0)) {
          clearTimeout(w.timer);
          w.reject(new Error(`${this.label}: socket closed (code ${ev.code}) while waiting`));
        }
      });
      this.ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return; // ignore non-JSON frames
        }
        // Serve the first waiter whose predicate matches, else queue.
        for (let i = 0; i < this.waiters.length; i++) {
          if (this.waiters[i].pred(msg)) {
            const [w] = this.waiters.splice(i, 1);
            clearTimeout(w.timer);
            w.resolve(msg);
            return;
          }
        }
        this.messages.push(msg);
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve with the first (queued or future) message matching pred. */
  waitFor(pred, timeoutMs, label) {
    const idx = this.messages.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.messages.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { pred, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const at = this.waiters.indexOf(waiter);
        if (at >= 0) this.waiters.splice(at, 1);
        reject(new Error(`${this.label}: timed out after ${timeoutMs}ms waiting for ${label}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }
}

function nearTarget(p) {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((v, i) => Math.abs(v - TARGET_POS[i]) < EPSILON)
  );
}

function randomToken() {
  return `test-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// ── The scenario ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`[test-sync] room ${roomCode} via ${wsUrl}`);

  // Client A joins a fresh room.
  const a = new Client('A');
  await a.connect();
  a.send({
    t: 'join',
    name: 'Tester-A',
    archetype: 'lumen',
    token: randomToken(),
    protocolVersion: PROTOCOL_VERSION,
  });
  const welcomeA = await a.waitFor((m) => m.t === 'welcome', STEP_TIMEOUT_MS, 'welcome');
  if (!welcomeA.playerId || !welcomeA.snapshot) fail('A: welcome message missing playerId/snapshot');
  pass(`A joined room ${roomCode} as Tester-A (playerId ${welcomeA.playerId})`);

  // Client B joins the same room and must see A in the snapshot.
  const b = new Client('B');
  await b.connect();
  b.send({
    t: 'join',
    name: 'Tester-B',
    archetype: 'veilseer',
    token: randomToken(),
    protocolVersion: PROTOCOL_VERSION,
  });
  const welcomeB = await b.waitFor((m) => m.t === 'welcome', STEP_TIMEOUT_MS, 'welcome');
  const players = welcomeB.snapshot?.players ?? [];
  if (!players.some((p) => p.name === 'Tester-A')) {
    fail(`B: welcome snapshot does not contain Tester-A (saw: ${players.map((p) => p.name).join(', ') || 'nobody'})`);
  }
  pass('B joined; welcome snapshot contains Tester-A');

  // A moves to a distinctive position; B must observe it via a state tick.
  a.send({ t: 'move', p: TARGET_POS, ry: TARGET_RY, a: 'walk' });
  const aId = welcomeA.playerId;
  try {
    await b.waitFor(
      (m) => m.t === 'state' && m.players.some((p) => p.id === aId && nearTarget(p.p)),
      STATE_TIMEOUT_MS,
      `a state broadcast placing A at [${TARGET_POS.join(', ')}]`,
    );
  } catch (err) {
    fail(err.message);
  }
  pass(`B observed A at [${TARGET_POS.join(', ')}] through the state broadcast`);

  pass('all checks passed — two clients sync through the Durable Object');
  clearTimeout(watchdog);
  a.close();
  b.close();
  process.exit(0);
}

main().catch((err) => fail(err.message ?? String(err)));
