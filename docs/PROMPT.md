Build a complete, deployable MVP of a web-based cooperative narrative mystery game called "Echoes of the Veil" for 6–10 players, ready to deploy after minor asset swaps and play with friends in one ~90-minute session.

First, before doing anything else, save this entire prompt verbatim as `docs/PROMPT.md` in the repo so it's preserved for reference. Create the `docs/` folder if needed. Then proceed with the build.

Generate as much of the full, working project as you can in a single pass. Do not pause for confirmation or ask clarifying questions — all creative and technical decisions are locked below.

## Concept
Players are "Veilwalkers" — a crew exploring and stabilizing a shared, living dream-world of surreal, beautiful locations (floating islands, corrupted crystal cities, underwater ruins, shifting forests). Strong overarching story with branching narrative, character backstories, moral choices, and consequences that persist across sessions. Blends co-op exploration, light puzzle-solving, and narrative depth with real-time group interaction.

## Locked creative direction (decisions, not questions — proceed with these)
- Art style: vibrant high-fantasy — saturated colors, luminous magic, lush stylized environments.
- Tone: mysterious + hopeful — wonder and discovery over dread; eerie moments resolve toward hope.
- Platform: desktop-only, maximum visual fidelity. Do not compromise visuals for mobile. No mobile/touch support required.

## Technical requirements
- Frontend: HTML5 + TypeScript + Vite. Three.js for 3D. Graphically rich: dynamic lighting, particle systems, post-processing (bloom, god rays, fog), stylized high-quality environments and characters, smooth animations, atmospheric effects. Before installing, check the current stable versions of Three.js and Vite and pin them in package.json rather than using floating "latest."
- Multiplayer: real-time co-op for 6–10 players via Cloudflare Durable Objects + WebSockets for authoritative state sync (world state, player positions, story progress, interactions). Voice chat: placeholder/stub only — do not implement a real WebRTC SFU. Include text and emote chat.
- Hosting: Cloudflare Pages (static frontend) + Workers + Durable Objects. Include wrangler.toml, routing, and a GitHub Actions workflow for auto-deploy on push. Include .env.example / secrets setup.
- Persistence: save progress, player stats, story branches, inventory, relationships via KV or Durable Objects. Support multiple campaigns/sessions.
- Audio: adaptive soundtrack + SFX via Web Audio API. Placeholder tracks + an easy swap system. Music shifts with story beats and player actions (ambient, tension, exploration, climax).
- UI/UX: immersive UI with minimap, character sheets, shared journal, story log, and "focus mode" (a player can anchor a scene for deeper narrative).
- Performance: loading screens, asset compression guidance. Optimize for desktop browsers.

## Deliverables
1. Full folder structure.
2. package.json, Vite config, TypeScript config.
3. Core source: main game loop, 3D scene manager, player controls, story engine (memory + branching), multiplayer sync, UI.
4. 3D asset descriptions ready for Meshy/Kaedim/Midjourney + import instructions.
5. Story bible: 5–7 locations, core plot arc with branches, character templates, random events.
6. Workers/Durable Object backend for real-time sync and persistence.
7. Deployment instructions: GitHub → Cloudflare Pages + Workers.
8. README.md: setup, run locally, play with friends, extend the story.

## Quality bar
Build in modular, well-commented files. After scaffolding, run `npm install` and `npm run build` and fix all errors you can. Do not present stubbed functions as complete — anything left as a placeholder must be explicitly labeled `// TODO` in code and listed in a "Known gaps / next steps" section of the README so I know exactly what remains. Prefer fewer fully-working systems over many half-built ones if you run short on space.

## Definition of done (aim for all; document any you couldn't reach)
- `npm run build` succeeds with no errors.
- `npm run dev` serves a navigable 3D scene.
- Two browser tabs can sync player position through the Durable Object locally (via wrangler dev or documented equivalent).
- wrangler.toml, the GitHub Actions deploy workflow, and .env.example are present.
- README documents local run, multiplayer test, and deploy steps.

Use modern best practices, clean modular architecture, and comments. Prioritize gameplay fun and visual wow-factor. Begin now.
