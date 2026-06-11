/**
 * src/core/AssetLoader.ts
 * Optional GLB swap-in point for real 3D assets (Meshy / Kaedim / hand-made).
 *
 * Asset-swap workflow:
 *   1. Locations call `tryLoadModel('<id>')` for their hero set-pieces (the id
 *      list and generation prompts live in docs/ASSETS.md).
 *   2. If `public/models/<id>.glb` exists, Vite serves it from the site root
 *      and the location places the loaded model instead of its procedural
 *      placeholder geometry.
 *   3. If the file is absent (404) — the default for a fresh checkout — the
 *      promise resolves `null` and the caller keeps its procedural fallback.
 *      No build steps, no manifest: drop a .glb in public/models/ and reload.
 *
 * Module-level functions by design (no class): the cache is process-global so
 * every location shares one loader and one in-flight promise per id.
 */

import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Promise cache keyed by model id. Failures are cached too, so a missing
// model costs exactly one network round-trip (and one console.info) per id
// per session.
const modelCache = new Map<string, Promise<THREE.Group | null>>();

// Lazily constructed so merely importing this module costs nothing.
let gltfLoader: GLTFLoader | null = null;

// TODO: add DRACOLoader / meshopt decoder support here when we start shipping
// compressed production assets (loader.setDRACOLoader(...) plus the decoder
// files in public/draco/). Uncompressed GLB is fine for the MVP set.

/**
 * Try to load `/models/<id>.glb`. Resolves with the model's scene graph, or
 * `null` on any failure (missing file, parse error) without console spam —
 * a single console.info notes the procedural fallback.
 *
 * Note: results are cached, so repeat calls for one id resolve with the SAME
 * Group instance. Hero set-pieces use unique ids; if you ever need multiple
 * copies of one model, clone the result before adding it to the scene.
 */
export function tryLoadModel(id: string): Promise<THREE.Group | null> {
  let pending = modelCache.get(id);
  if (!pending) {
    pending = loadModel(id);
    modelCache.set(id, pending);
  }
  return pending;
}

function loadModel(id: string): Promise<THREE.Group | null> {
  gltfLoader ??= new GLTFLoader();
  const url = `/models/${id}.glb`;
  return new Promise((resolve) => {
    gltfLoader!.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => {
        // Expected path while assets are procedural — keep it to one quiet line.
        console.info(`[assets] no model at ${url}; using procedural geometry for "${id}"`);
        resolve(null);
      },
    );
  });
}
