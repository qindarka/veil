/**
 * src/world/LocationBase.ts
 * Abstract base for the six dream-world locations. Subclasses implement
 * buildScene() to populate `group` with procedural geometry, register
 * interactables and per-frame dynamics, and override getGroundHeight() to
 * match their terrain so avatars walk on it.
 */

import * as THREE from 'three';
import type { LocationId, MusicMood } from '../../shared/constants';
import type {
  EnvironmentSettings,
  GameContext,
  ILocation,
  Interactable,
  Updatable,
  Vec3,
} from '../types';

export abstract class LocationBase implements ILocation {
  abstract readonly id: LocationId;
  abstract readonly environment: EnvironmentSettings;
  abstract readonly spawn: { position: Vec3; yaw: number };

  readonly group = new THREE.Group();
  readonly boundsRadius: number = 60;
  readonly defaultMood: MusicMood = 'exploration';
  readonly interactables: Interactable[] = [];

  /** Anything that needs a per-frame tick (water, particles, glyphs...). */
  protected dynamics: Updatable[] = [];
  private built = false;

  async build(ctx: GameContext, onProgress: (p: number) => void): Promise<void> {
    if (this.built) return;
    await this.buildScene(ctx, onProgress);
    this.built = true;
    onProgress(1);
  }

  /** Populate `group`. Long builds should call onProgress with 0..1 milestones. */
  protected abstract buildScene(
    ctx: GameContext,
    onProgress: (p: number) => void,
  ): Promise<void>;

  update(dt: number, elapsed: number): void {
    for (const d of this.dynamics) d.update(dt, elapsed);
    for (const it of this.interactables) it.update?.(dt, elapsed);
  }

  /** Flat by default; terrain-following locations override this. */
  getGroundHeight(_x: number, _z: number): number {
    return 0;
  }

  onEnter?(ctx: GameContext): void;
  onExit?(ctx: GameContext): void;

  /** Register an interactable and add its object to the scene graph. */
  protected addInteractable(it: Interactable): Interactable {
    this.interactables.push(it);
    if (!it.object.parent) this.group.add(it.object);
    return it;
  }

  protected addDynamic<T extends Updatable>(d: T): T {
    this.dynamics.push(d);
    return d;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });
    this.group.clear();
    this.dynamics.length = 0;
    this.interactables.length = 0;
  }
}
