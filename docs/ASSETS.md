# 3D Asset Pipeline — descriptions & import instructions

The game is fully playable with its built-in procedural art. Every hero
set-piece also has a **drop-in swap point**: if a GLB exists at
`public/models/<id>.glb`, the location loads it instead of building the
procedural version (see `src/core/AssetLoader.ts` → `tryLoadModel(id)`).
No code changes needed — export, rename, drop in, refresh.

## Global style brief (paste ahead of every generation prompt)

> Vibrant high-fantasy game asset, stylized hand-painted look, saturated
> jewel tones, luminous emissive magical accents, clean silhouette, low-poly
> friendly with smooth bevels, no photorealism, no text, single object on
> neutral background, game-ready.

Targets: **GLB (glTF binary)**, Y-up, real-world meters, pivot at the
object's ground contact point, ≤ 25k tris for set-pieces, 1–2 materials,
2048px max textures. Emissive parts should use the glTF emissive channel —
the game's bloom pass makes them glow.

## Asset list (swap ids the code already looks for)

| Id (`public/models/<id>.glb`) | Used in | Scale | Description for Meshy / Kaedim / Midjourney-→-3D |
| --- | --- | --- | --- |
| `skyharbor_loom` | Skyharbor | ~6m tall | An elegant freestanding arch-loom of pale driftwood and gold filigree, strung with dozens of taut threads of glowing golden light converging toward a suspended shuttle of crystal; gentle teal accent gems; ancient, warm, holy. |
| `skyharbor_lantern_tree` | Skyharbor | ~14m tall | A great windswept tree with smooth lavender-grey bark and a broad twilight-teal canopy, hung with many small hexagonal brass lanterns glowing warm gold on cords of differing length; roots gripping a rocky outcrop. |
| `wood_heartwood_tree` | Wandering Wood | ~22m tall | A colossal mother-tree with braided luminous roots, moss-covered violet bark, and a dome canopy of teal-and-violet leaves with glowing spring-green veins; small bioluminescent mushrooms ringing the base; serene and ancient. |
| `mirrormere_arch` | Mirrormere | ~5m tall | A weathered freestanding stone arch of silver-grey rock, hairline cracks filled with faintly glowing pale-blue light, frost-like etched runes near the base; quiet, lunar, monumental despite its size. |
| `caelis_spire` | Caelis | ~18m tall | A tapering city-spire grown from translucent violet-magenta crystal, terraced like a cathedral, inner light pulsing softly; one flank dimmed to smoky black crystal with thin smoldering crimson veins (corruption creeping in). |
| `archive_orrery` | Sunken Archive | ~5m tall | A grand brass-and-verdigris orrery: three nested gimbal rings around a glowing pearl sun, mounted on a marble pedestal encrusted with barnacles and soft coral; beams of light caught in the rings; drowned-library mood. |
| `heart_dreamer_figure` | Heart of the Veil | ~40m tall | A colossal serene humanoid figure curled in sleep, half-formed from night sky — body of deep indigo with constellation seams of golden light, face peaceful, edges dissolving into drifting star-mist; hopeful, not ominous. |

Want to swap something not on the list? Add a `tryLoadModel('<your-id>')`
call with a procedural fallback in the relevant location file — the loader
handles caching and missing-file fallback for you.

## Generation workflow

**Meshy / Kaedim (text-to-3D or image-to-3D):**

1. Generate with the style brief + the table description. For best topology,
   generate concept art first (below) and use image-to-3D.
2. Export **GLB** with PBR + emissive. Check scale/pivot in
   [gltf.report](https://gltf.report) or Blender (apply transforms, Y-up).
3. Rename to the exact id and drop into `public/models/`.

**Midjourney (concept art / image-to-3D source), per asset:**

> `<table description>` — full shot, centered, isolated on dark neutral
> backdrop, stylized fantasy game art, painterly, volumetric glow,
> concept sheet --ar 1:1

## Compression guidance (do this before shipping)

- `npx gltfpack -i in.glb -o out.glb -cc -tc` — meshopt geometry compression
  + KTX2/BasisU texture compression; typically 5–10× smaller.
- Keep set-pieces under ~2 MB compressed; the whole model folder under
  ~20 MB for a comfortable first load.
- `// TODO` in `AssetLoader.ts`: DRACO/meshopt decoder registration is not
  wired yet — plain GLB loads today; add `MeshoptDecoder` when you start
  shipping gltfpack-compressed files (one-liner documented in the file).
- Audio swaps are documented in `public/audio/README.md` (drop
  `public/audio/music/<mood>.ogg` files to replace the procedural score).

## Character/avatar note

Player avatars are procedural luminous "Veilwalkers" (hooded light-figures
tinted per archetype) by design — they read clearly at a distance, cost
nothing to load, and sidestep rigging/animation for the MVP. If you want
modeled avatars later, budget for a rigged GLB + three.js AnimationMixer
work in `src/player/Avatar.ts`.
