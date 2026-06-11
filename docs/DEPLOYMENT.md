# Deployment — Cloudflare dashboard Git integration

One Worker serves everything: the built client (`dist/`, as static assets)
and the realtime API (`/api/*`, one Durable Object per campaign room code).
Because site and API share an origin, the client needs **no configured
backend URL** — and deployment is the point-and-click flow you already know:
connect the GitHub repo in the Cloudflare dashboard and every push builds and
deploys automatically. No API tokens, no GitHub secrets, no wrangler CLI.

## Setup (one time, all in the dashboard)

1. Cloudflare dashboard → **Workers & Pages → Create → Workers →
   Import a repository** (connect your GitHub account if prompted and pick
   `veil`).
2. Project/worker name: anything (e.g. `echoes-of-the-veil` to match
   wrangler.toml).
3. Build settings:
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy` (the usual default)
4. Save and deploy.

That's it. Cloudflare clones the repo, runs the build, reads `wrangler.toml`
(static assets from `dist/`, the `VeilRoom` Durable Object binding and its
migration), and deploys. Every push to `main` repeats this automatically;
the game is live at `https://<worker-name>.<your-subdomain>.workers.dev`
(attach a custom domain on the worker's Settings → Domains & Routes if you
like). Share that URL plus a room code with friends and play.

Notes:

- The first deploy runs the Durable Object migration (`v1`,
  `new_sqlite_classes = ["VeilRoom"]`) declared in wrangler.toml. SQLite-backed
  DOs work on the free plan.
- GitHub Actions runs a secrets-free CI build check on each push
  (`.github/workflows/ci.yml`); deployment itself is Cloudflare-side.
- `wrangler.toml` sets `ALLOWED_ORIGIN = "*"` for the HTTP endpoints. Since
  site and API are same-origin you can tighten it to your workers.dev /
  custom domain, but it's not required.

## Manual deploy (optional CLI alternative)

If you ever want to deploy from your machine instead:

```sh
npx wrangler login
npm run deploy        # = npm run build && wrangler deploy
```

## Troubleshooting

- **Build fails in Cloudflare** → check the build log in the dashboard; it
  must be running `npm run build` on Node 22+ (set the `NODE_VERSION`
  environment variable to `22` in the project's build settings if needed).
- **Site loads but multiplayer doesn't connect** → the client connects
  same-origin in production; if you front the worker with another host,
  either route `/api/*` through to it or bake `VITE_WORKER_URL` into the
  build (see `.env.example`).
- **`wrangler deploy` complains about migrations** → the DO class was
  renamed; add a new `[[migrations]]` entry rather than editing `v1`.
