/**
 * src/player/PlayerController.ts
 * The local player: WASD/arrow movement (camera-relative, smooth accel/decel,
 * ground-follow), the third-person orbit camera (drag-orbit + pointer lock,
 * wheel zoom, invertY), interaction scanning/highlighting, and the hotkeys
 * E (interact) + F (focus). Panel hotkeys (J/C/O/H) belong to UIManager and
 * emote digits (1-8) to HUD. Owns the local Avatar, rebuilt from
 * ctx.state.you on net:welcome. This controller never sends movement to the
 * network itself — NetworkClient samples position/yaw/anim.
 */

import * as THREE from 'three';
import { ARCHETYPES } from '../../shared/archetypes';
import type { AnimState } from '../../shared/constants';
import type { PlayerInfo } from '../../shared/protocol';
import type {
  GameContext,
  Interactable,
  InteractableInfo,
  IPlayerController,
  Vec3,
} from '../types';
import { Avatar } from './Avatar';

// ── Tuning ───────────────────────────────────────────────────────────────────

const WALK_SPEED = 4; // m/s
const RUN_SPEED = 8; // m/s
const ACCEL = 12; // m/s^2 toward the target velocity (also decel)
const TURN_RATE = 12; // 1/s exponential ease of avatar yaw toward move dir
const GROUND_EASE = 10; // 1/s exponential ease of y toward ground height
const CAM_MIN_DIST = 3;
const CAM_MAX_DIST = 12;
const CAM_PITCH_MIN = -0.1;
const CAM_PITCH_MAX = 1.2;
const CAM_HEAD_HEIGHT = 1.55; // orbit target above the avatar's feet
const CAM_FOLLOW_EASE = 8; // 1/s smoothing of the follow target
const CAM_ZOOM_EASE = 10; // 1/s smoothing of the zoom distance
const CAM_GROUND_CLEARANCE = 0.5; // camera stays at least this far above ground
const MOUSE_SENS = 0.0042; // rad per pixel
const CLICK_DRAG_THRESHOLD = 4; // px of motion below which mouseup counts as a click

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);

/** Shortest-arc angle difference b-a, normalized to [-PI, PI]. */
function angleDelta(a: number, b: number): number {
  return ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

export class PlayerController implements IPlayerController {
  readonly position = new THREE.Vector3();

  private ctx!: GameContext;
  private canvas!: HTMLCanvasElement;
  private avatar!: Avatar;

  private readonly velocity = new THREE.Vector3();
  private _yaw = 0;
  private _anim: AnimState = 'idle';
  private frozen = false;
  private invertY = false;

  // Camera rig state.
  private camYaw = Math.PI;
  private camPitch = 0.45;
  private camDist = 7;
  private camTargetDist = 7;
  private readonly followPos = new THREE.Vector3(0, CAM_HEAD_HEIGHT, 0);

  /** Arrival camera sweep; non-null while playing (see playArrivalCinematic). */
  private cinematic: { t: number; duration: number; endYaw: number } | null = null;

  // Input state.
  private readonly keys = new Set<string>();
  private pointerLocked = false;
  private dragging = false;
  private dragMoved = 0;

  private lastInteractable: Interactable | null = null;
  private readonly unsubs: Array<() => void> = [];

  // Scratch vectors (avoid per-frame allocation).
  private readonly tmpHead = new THREE.Vector3();
  private readonly tmpCam = new THREE.Vector3();

  get yaw(): number {
    return this._yaw;
  }

  get anim(): AnimState {
    return this._anim;
  }

  get avatarObject(): THREE.Object3D {
    return this.avatar.group;
  }

  get cinematicActive(): boolean {
    return this.cinematic !== null;
  }

  playArrivalCinematic(lookTarget: THREE.Vector3 | null): void {
    if (this.cinematic) return;
    // End the sweep facing the first objective: the camera parks on the far
    // side of the avatar from the target, looking across it.
    const endYaw = lookTarget
      ? Math.atan2(this.position.x - lookTarget.x, this.position.z - lookTarget.z)
      : this.camYaw;
    this.cinematic = { t: 0, duration: 5, endYaw };
    document.exitPointerLock?.();
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.canvas = ctx.scene.renderer.domElement;
    this.invertY = ctx.state.settings.invertY;

    // Placeholder avatar until the welcome snapshot tells us who we are.
    this.buildAvatar(0x8d7bff, 'Veilwalker');

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    this.unsubs.push(
      ctx.events.on('net:welcome', ({ snapshot }) => this.onWelcome(snapshot.you)),
      ctx.events.on('settings:changed', ({ settings }) => {
        this.invertY = settings.invertY;
      }),
      ctx.events.on('ui:input-capture', ({ captured }) => {
        if (captured) {
          // Drop held keys so movement can't get stuck while a modal is open,
          // and release the mouse so the cursor is usable in the UI.
          this.keys.clear();
          this.dragging = false;
          if (this.pointerLocked) document.exitPointerLock();
        }
      }),
      // The current location is being torn down; forget its interactables.
      ctx.events.on('world:travel-begin', () => this.clearInteractable()),
    );
  }

  // ── Avatar lifecycle ───────────────────────────────────────────────────────

  /** (Re)build the local avatar from the welcome snapshot's identity. */
  private onWelcome(you: PlayerInfo): void {
    this.buildAvatar(ARCHETYPES[you.archetype].color, you.name);
  }

  private buildAvatar(color: number, name: string): void {
    const old = this.avatar as Avatar | undefined;
    if (old) old.dispose(); // dispose() also removes the group from the scene
    this.avatar = new Avatar({ color, name, isSelf: true });
    this.avatar.group.position.copy(this.position);
    this.avatar.group.rotation.y = this._yaw;
    // The avatar lives at the scene root, never inside location groups, so it
    // survives travel teardown.
    this.ctx.scene.scene.add(this.avatar.group);
  }

  // ── Input handlers ─────────────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.cinematic) {
      // Any key skips the arrival sweep (it settles on the next frame).
      this.cinematic.t = this.cinematic.duration;
      return;
    }
    if (this.ctx.ui.inputCaptured) return; // chat/menu owns the keyboard

    if (MOVE_CODES.has(e.code) || SHIFT_CODES.has(e.code)) {
      this.keys.add(e.code);
      if (MOVE_CODES.has(e.code)) e.preventDefault(); // arrows scroll the page
      return;
    }
    if (e.repeat) return;

    switch (e.code) {
      case 'KeyE':
        if (this.lastInteractable) {
          this.ctx.events.emit('interact:request', { objectId: this.lastInteractable.id });
        }
        return;
      case 'KeyF':
        this.ctx.story.toggleFocus();
        return;
      case 'KeyG':
        // Crew ping at our feet; the server echoes it to the whole party
        // (ourselves included), so the visual comes from one code path.
        this.ctx.net.send({
          t: 'marker',
          p: [this.position.x, this.position.y, this.position.z],
        });
        return;
    }
    // J/C/O/H panel hotkeys live in UIManager and Digit1-8 emotes live in
    // HUD — the controller must not also bind them or they double-fire.
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    // Always process keyup (even when captured) so keys never stick.
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.cinematic) {
      this.cinematic.t = this.cinematic.duration; // skip the arrival sweep
      return;
    }
    if (e.button !== 0 || this.ctx.ui.inputCaptured) return;
    this.dragging = true;
    this.dragMoved = 0;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.pointerLocked) {
      this.applyLook(e.movementX, e.movementY);
      return;
    }
    if (!this.dragging) return;
    this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
    this.applyLook(e.movementX, e.movementY);
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    // A motionless click on the canvas requests pointer lock (Esc releases it,
    // handled natively by the browser); a drag was just an orbit.
    if (
      this.dragging &&
      !this.pointerLocked &&
      this.dragMoved < CLICK_DRAG_THRESHOLD &&
      !this.ctx.ui.inputCaptured
    ) {
      try {
        const result = this.canvas.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => {}); // may be denied; drag still works
      } catch {
        // Pointer lock unsupported; drag-orbit remains available.
      }
    }
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines -> px-ish
    this.camTargetDist = THREE.MathUtils.clamp(
      this.camTargetDist + dy * 0.01,
      CAM_MIN_DIST,
      CAM_MAX_DIST,
    );
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  private applyLook(movementX: number, movementY: number): void {
    this.camYaw -= movementX * MOUSE_SENS;
    const dir = this.invertY ? -1 : 1;
    this.camPitch = THREE.MathUtils.clamp(
      this.camPitch + movementY * MOUSE_SENS * dir,
      CAM_PITCH_MIN,
      CAM_PITCH_MAX,
    );
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(dt: number, elapsed: number): void {
    const world = this.ctx.world;

    // — Movement input (camera-relative on the XZ plane).
    let ix = 0;
    let iz = 0;
    if (!this.frozen && !this.ctx.ui.inputCaptured && !this.cinematic) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    }
    // Camera forward projected to XZ: the camera sits at +(sin,cos)*camYaw
    // from the player, so forward (toward where we look) is the negation.
    const fwdX = -Math.sin(this.camYaw);
    const fwdZ = -Math.cos(this.camYaw);
    // right = forward x up
    let mvX = fwdX * iz + -fwdZ * ix;
    let mvZ = fwdZ * iz + fwdX * ix;
    const mvLen = Math.hypot(mvX, mvZ);
    let targetVX = 0;
    let targetVZ = 0;
    if (mvLen > 1e-4) {
      const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = running ? RUN_SPEED : WALK_SPEED;
      targetVX = (mvX / mvLen) * speed;
      targetVZ = (mvZ / mvLen) * speed;
    }

    // — Smooth accel/decel: step velocity toward the target at ACCEL m/s^2.
    const dvX = targetVX - this.velocity.x;
    const dvZ = targetVZ - this.velocity.z;
    const dvLen = Math.hypot(dvX, dvZ);
    const maxStep = ACCEL * dt;
    if (dvLen <= maxStep || dvLen < 1e-6) {
      this.velocity.x = targetVX;
      this.velocity.z = targetVZ;
    } else {
      this.velocity.x += (dvX / dvLen) * maxStep;
      this.velocity.z += (dvZ / dvLen) * maxStep;
    }

    // — Integrate, clamp to the location bounds, follow the ground.
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.clampToBounds(this.position);
    const groundY = world.getGroundHeight(this.position.x, this.position.z);
    this.position.y += (groundY - this.position.y) * (1 - Math.exp(-GROUND_EASE * dt));

    // — Yaw: turn smoothly toward the move direction while moving.
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed > 0.25) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
      this._yaw += angleDelta(this._yaw, targetYaw) * (1 - Math.exp(-TURN_RATE * dt));
      this._yaw = Math.atan2(Math.sin(this._yaw), Math.cos(this._yaw)); // keep normalized
    }

    // — Animation state from horizontal speed.
    this._anim = speed > (WALK_SPEED + RUN_SPEED) / 2 ? 'run' : speed > 0.35 ? 'walk' : 'idle';

    // — Drive the avatar.
    this.avatar.group.position.copy(this.position);
    this.avatar.group.rotation.y = this._yaw;
    this.avatar.setAnim(this._anim);
    this.avatar.update(dt, elapsed);

    if (this.cinematic) {
      this.updateCinematic(dt);
    } else {
      this.updateCamera(dt);
    }
    this.scanInteractables();
  }

  /**
   * Arrival sweep: a slow descending spiral from high above the spawn down
   * into the normal third-person rig, ending faced toward the objective.
   * Any input skips it (handled in the input listeners).
   */
  private updateCinematic(dt: number): void {
    const cine = this.cinematic!;
    cine.t += dt;
    const p = Math.min(1, cine.t / cine.duration);
    const ease = p * p * (3 - 2 * p); // smoothstep

    this.camYaw = cine.endYaw + (1 - ease) * 1.7; // unwinding spiral
    this.camPitch = THREE.MathUtils.lerp(1.2, 0.45, ease);
    this.camDist = THREE.MathUtils.lerp(34, this.camTargetDist, ease);
    this.tmpHead.set(this.position.x, this.position.y + CAM_HEAD_HEIGHT, this.position.z);
    this.followPos.copy(this.tmpHead);

    const cosPitch = Math.cos(this.camPitch);
    this.tmpCam.set(
      this.followPos.x + Math.sin(this.camYaw) * cosPitch * this.camDist,
      this.followPos.y + Math.sin(this.camPitch) * this.camDist,
      this.followPos.z + Math.cos(this.camYaw) * cosPitch * this.camDist,
    );
    const camera = this.ctx.scene.camera;
    camera.position.copy(this.tmpCam);
    camera.lookAt(this.followPos);

    if (p >= 1) {
      this.cinematic = null;
      this.camYaw = cine.endYaw;
      this.camPitch = 0.45;
    }
  }

  /** Orbit-rig camera: smoothed follow target + zoom, ground clearance. */
  private updateCamera(dt: number, snap = false): void {
    this.tmpHead.set(this.position.x, this.position.y + CAM_HEAD_HEIGHT, this.position.z);
    if (snap) {
      this.followPos.copy(this.tmpHead);
      this.camDist = this.camTargetDist;
    } else {
      this.followPos.lerp(this.tmpHead, 1 - Math.exp(-CAM_FOLLOW_EASE * dt));
      this.camDist += (this.camTargetDist - this.camDist) * (1 - Math.exp(-CAM_ZOOM_EASE * dt));
    }

    const cosPitch = Math.cos(this.camPitch);
    this.tmpCam.set(
      this.followPos.x + Math.sin(this.camYaw) * cosPitch * this.camDist,
      this.followPos.y + Math.sin(this.camPitch) * this.camDist,
      this.followPos.z + Math.cos(this.camYaw) * cosPitch * this.camDist,
    );
    // Never let the camera sink into the terrain.
    const camGround = this.ctx.world.getGroundHeight(this.tmpCam.x, this.tmpCam.z);
    if (this.tmpCam.y < camGround + CAM_GROUND_CLEARANCE) {
      this.tmpCam.y = camGround + CAM_GROUND_CLEARANCE;
    }

    const camera = this.ctx.scene.camera;
    camera.position.copy(this.tmpCam);
    camera.lookAt(this.followPos);
  }

  /** Track the nearest interactable; update highlight + prompt on change. */
  private scanInteractables(): void {
    const nearest = this.ctx.world.findNearestInteractable(this.position);
    if (nearest === this.lastInteractable) return;
    this.lastInteractable?.setHighlight(false);
    nearest?.setHighlight(true);
    this.lastInteractable = nearest;

    const info: InteractableInfo | null = nearest
      ? {
          id: nearest.id,
          kind: nearest.kind,
          prompt: nearest.prompt,
          requiresArchetype: nearest.requiresArchetype,
        }
      : null;
    // Single writer: UIManager renders this event (the HUD pill draws its own
    // E keycap, so the text here must be the bare prompt).
    this.ctx.events.emit('interact:prompt', { info });
  }

  private clearInteractable(): void {
    if (!this.lastInteractable) return;
    this.lastInteractable.setHighlight(false);
    this.lastInteractable = null;
    this.ctx.events.emit('interact:prompt', { info: null });
  }

  // ── IPlayerController ──────────────────────────────────────────────────────

  teleport(pos: Vec3, yaw?: number): void {
    this.position.set(pos[0], pos[1], pos[2]);
    // Snap straight onto the terrain so there is no easing dip after travel.
    this.position.y = this.ctx.world.getGroundHeight(pos[0], pos[2]);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this._yaw = yaw;
    this.avatar.group.position.copy(this.position);
    this.avatar.group.rotation.y = this._yaw;
    // Snap the camera behind the player, facing the same way.
    this.camYaw = this._yaw + Math.PI;
    this.updateCamera(0, true);
    this.ctx.events.emit('player:teleported', {
      pos: [this.position.x, this.position.y, this.position.z],
    });
  }

  setFrozen(frozen: boolean): void {
    // Blocks movement input only — the camera still orbits while frozen.
    this.frozen = frozen;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    this.avatar.dispose();
  }
}
