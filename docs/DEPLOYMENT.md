# Deployment — GitHub → Cloudflare Pages + Workers

The game ships as two Cloudflare pieces:

- **Worker + Durable Object** (`wrangler.toml`, `worker/src/`) — the realtime
  backend. One Durable Object instance per campaign room code.
- **Cloudflare Pages** — the static Vite build (`dist/`) of the client.

Pushing to `main` deploys both via `.github/workflows/deploy.yml`.

## One-time setup

### 1. Cloudflare account pieces

1. Create (or log into) a Cloudflare account and note your **Account ID**
   (dashboard → Workers & Pages → right sidebar).
2. Create an **API token**: dashboard → My Profile → API Tokens →
   Create Token → start from "Edit Cloudflare Workers", and add the
   **Cloudflare Pages: Edit** permission. Scope it to your account.
3. Create the Pages project (one time, from your machine):

   ```sh
   npx wrangler login
   npx wrangler pages project create echoes-of-the-veil --production-branch=main
   ```

4. Deploy the worker once to learn its URL:

   ```sh
   npx wrangler deploy
   # → https://echoes-of-the-veil.<your-subdomain>.workers.dev
   ```

   The first deploy also runs the Durable Object migration (`v1`,
   `new_sqlite_classes = ["VeilRoom"]`) declared in wrangler.toml.

### 2. GitHub repository configuration

Settings → Secrets and variables → Actions:

| Kind     | Name                    | Value                                   |
| -------- | ----------------------- | --------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | the token from step 2                   |
| Secret   | `CLOUDFLARE_ACCOUNT_ID` | your account id                         |
| Variable | `VITE_WORKER_URL`       | the workers.dev URL from step 4 (no trailing slash) |

`VITE_WORKER_URL` is baked into the client at build time — it is how the
deployed frontend finds the WebSocket backend.

### 3. Push

```sh
git push origin main
```

The `Deploy` workflow typechecks, builds, deploys the worker, then publishes
`dist/` to Pages. Your game is live at
`https://echoes-of-the-veil.pages.dev` (plus any custom domain you attach to
the Pages project).

## Manual deploys (no CI)

```sh
# Backend
npm run deploy:worker

# Frontend (set the worker URL for the build)
VITE_WORKER_URL=https://echoes-of-the-veil.<subdomain>.workers.dev npm run deploy:pages
```

## CORS / origins

`wrangler.toml` sets `ALLOWED_ORIGIN = "*"` for the HTTP endpoints (room info,
health). Tighten it to your Pages origin
(`https://echoes-of-the-veil.pages.dev`) for production if you prefer.

## Costs & limits

- Durable Objects (SQLite-backed) and Workers free tiers comfortably cover a
  friends-scale game; the room DO stays in memory only while players are
  connected (a 10Hz broadcast interval pins it during play).
- Pages static hosting is free for this scale.

## Troubleshooting

- **Client connects to nothing in prod** → `VITE_WORKER_URL` repo variable
  missing/wrong at build time. Re-run the workflow after fixing.
- **`wrangler deploy` complains about migrations** → the DO class was renamed;
  add a new `[[migrations]]` entry rather than editing `v1`.
- **WebSocket fails only on https** → ensure the worker URL uses `https://`
  (the client upgrades it to `wss://`).
