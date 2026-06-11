/**
 * worker/src/index.ts
 * Cloudflare Worker entry point — the thin HTTP edge in front of the rooms.
 * Routes:
 *   GET  /api/health           -> liveness probe ({ ok: true })
 *   *    /api/room/:code/info  -> forwarded to the room's Durable Object
 *   *    /api/room/:code/ws    -> WebSocket upgrade, forwarded to the DO
 * One Durable Object instance per room code (idFromName), so one room code is
 * one whole persistent campaign. CORS is applied here (ALLOWED_ORIGIN var) so
 * the DO never has to think about it; 101 upgrade responses pass through
 * untouched because they carry the socket.
 */

import { isValidRoomCode, normalizeRoomCode } from '../../shared/constants';
import { VeilRoom } from './VeilRoom';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Origin allowed for cross-origin API calls ("*" = any). */
  ALLOWED_ORIGIN: string;
}

const ROOM_PATH = /^\/api\/room\/([^/]+)\/(info|ws)$/;

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(env: Env, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight for any API path.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json(env, 200, { ok: true });
    }

    const match = ROOM_PATH.exec(url.pathname);
    if (match) {
      // Room codes are user-typed: normalize (uppercase, strip separators)
      // before validating so "abc-d2e" and "ABCD2E" reach the same campaign.
      const code = normalizeRoomCode(match[1]);
      if (!isValidRoomCode(code)) {
        return json(env, 400, { error: 'Invalid room code.' });
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      // Preserve the path but swap in the canonical code so the DO sees a
      // normalized URL regardless of how the player typed it.
      url.pathname = `/api/room/${code}/${match[2]}`;
      const response = await stub.fetch(new Request(url.toString(), request));
      // 101 Switching Protocols carries the WebSocket; pass through untouched
      // (wrapping it in a new Response would drop the socket).
      if (response.status === 101) return response;
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(env))) {
        headers.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers });
    }

    return json(env, 404, { error: 'Not found.' });
  },
} satisfies ExportedHandler<Env>;

// Durable Object class must be exported from the Worker entry for the binding
// declared in wrangler.toml ([[durable_objects.bindings]] class_name).
export { VeilRoom };
