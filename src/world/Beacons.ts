/**
 * src/world/Beacons.ts
 * Golden guidance pillars over the current objective's targets — the
 * "follow the light" layer for first-time parties. Driven entirely by
 * src/story/objectives.ts: when the objective's targets are in another
 * location, the local waygate that leads toward them is beaconed instead.
 * Owned and refreshed by WorldManager (travel, flag changes, welcome).
 */

import * as THREE from 'three';
import { createLightShaft } from './builders';
import { localTargets, resolveObjective } from '../story/objectives';
import type { GameContext, ILocation } from '../types';

const BEACON_COLOR = 0xffd27a;
const BEACON_HEIGHT = 26;

interface Beacon {
  shaft: THREE.Mesh;
  baseOpacity: number;
}

export class Beacons {
  private beacons: Beacon[] = [];
  private group = new THREE.Group();
  private attachedTo: THREE.Group | null = null;
  private lastKey = '';

  /** Rebuild beacons for the current location + objective (cheap; idempotent). */
  refresh(ctx: GameContext, location: ILocation | null): void {
    // Offline solo mode has no story director — no golden path to point at.
    if (!location || ctx.net.offlineMode) {
      this.clear();
      return;
    }
    const objective = resolveObjective(ctx.state);
    const portals = location.interactables
      .filter((it) => it.kind === 'portal' && it.portalTo)
      .map((it) => ({ id: it.id, to: it.portalTo! }));
    const ids = localTargets(objective, location.id, portals);

    const key = `${location.id}|${objective.id}|${ids.join(',')}`;
    if (key === this.lastKey && this.attachedTo === location.group) return;
    this.lastKey = key;

    this.clear();
    this.attachedTo = location.group;
    location.group.add(this.group);

    for (const id of ids) {
      const target = location.interactables.find((it) => it.id === id);
      if (!target) continue;
      const shaft = createLightShaft({
        color: BEACON_COLOR,
        height: BEACON_HEIGHT,
        radiusTop: 0.25,
        radiusBottom: 1.0,
        opacity: 0.14,
      });
      const pos = new THREE.Vector3();
      target.object.getWorldPosition(pos);
      // Interactables live inside the location group; convert into its space.
      this.group.worldToLocal(pos);
      shaft.position.copy(pos);
      this.group.add(shaft);
      this.beacons.push({ shaft, baseOpacity: 0.14 });
    }
  }

  /** Gentle breathing pulse so the pillars read as invitation, not alarm. */
  update(_dt: number, elapsed: number): void {
    if (this.beacons.length === 0) return;
    const pulse = 0.75 + 0.25 * Math.sin(elapsed * 1.6);
    for (const b of this.beacons) {
      (b.shaft.material as THREE.MeshBasicMaterial).opacity = b.baseOpacity * pulse;
    }
  }

  clear(): void {
    for (const b of this.beacons) {
      b.shaft.geometry.dispose();
      (b.shaft.material as THREE.Material).dispose();
    }
    this.beacons = [];
    this.group.clear();
    this.attachedTo?.remove(this.group);
    this.attachedTo = null;
    this.lastKey = '';
  }
}
