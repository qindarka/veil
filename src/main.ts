/**
 * src/main.ts
 * Entry point. Verifies WebGL2 support, grabs the canvas and UI root from
 * index.html, constructs the Game and boots it. Fatal errors route to
 * ui.showFatalError when the UIManager is alive, with a minimal self-contained
 * DOM overlay as the last-resort fallback (used when even construction fails,
 * e.g. no WebGL2 context).
 */

import { Game } from './core/Game';

/**
 * Last-resort error overlay built with raw DOM + inline styles so it works
 * even when UIManager / stylesheets / WebGL are unavailable. Styled to match
 * the game's indigo-and-gold look so a hard failure still feels intentional.
 */
function showInlineFatal(title: string, message: string): void {
  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alert');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:radial-gradient(ellipse at 50% 40%, #1a1230 0%, #0b0716 70%)',
    'color:#e8e2f4',
    "font-family:Georgia,'Times New Roman',serif",
    'pointer-events:auto',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'max-width:560px',
    'margin:1rem',
    'padding:2.5rem 3rem',
    'text-align:center',
    'background:rgba(16,10,32,0.92)',
    'border:1px solid rgba(255,210,122,0.45)',
    'border-radius:10px',
    'box-shadow:0 0 60px rgba(141,123,255,0.25)',
  ].join(';');

  const h1 = document.createElement('h1');
  h1.textContent = title;
  h1.style.cssText = 'margin:0 0 1rem;font-size:1.6rem;font-weight:normal;color:#ffd27a;letter-spacing:0.04em';

  const p = document.createElement('p');
  p.textContent = message;
  p.style.cssText = 'margin:0;font-size:1rem;line-height:1.6;color:#cfc6e8';

  panel.append(h1, p);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

/** WebGL2 is a hard requirement (instancing, MRT-friendly post chain). */
function hasWebGL2(): boolean {
  try {
    if (typeof WebGL2RenderingContext === 'undefined') return false;
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function boot(): void {
  if (!hasWebGL2()) {
    // UIManager needs a working game shell; build the overlay by hand here.
    showInlineFatal(
      'The Veil will not open here',
      'Echoes of the Veil needs a desktop browser with WebGL2 (hardware acceleration enabled). ' +
        'Please try a current version of Chrome, Firefox or Edge, and check that graphics ' +
        'acceleration is not disabled in your browser settings.',
    );
    return;
  }

  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !(uiRoot instanceof HTMLElement)) {
    // index.html guarantees these exist; this guards against a mangled build.
    showInlineFatal(
      'The threshold is broken',
      'The page is missing its #game-canvas or #ui-root element. This build appears to be ' +
        'corrupted — try a hard refresh (Ctrl+Shift+R).',
    );
    return;
  }

  let game: Game;
  try {
    game = new Game(canvas, uiRoot);
  } catch (err) {
    // Renderer/context construction failed before the UI existed.
    console.error('[main] failed to construct Game', err);
    showInlineFatal(
      'The Veil flickered and closed',
      `Something failed while waking the dream: ${describeError(err)}. ` +
        'Refresh to try again; if it persists, update your graphics drivers or browser.',
    );
    return;
  }

  game.run().catch((err: unknown) => {
    console.error('[main] fatal error during run()', err);
    const title = 'The Veil flickered and closed';
    const message =
      `Something failed while waking the dream: ${describeError(err)}. ` +
      'Refresh the page to try again.';
    // Prefer the in-game error screen; fall back to the inline overlay if the
    // UIManager itself is what broke.
    try {
      game.ui.showFatalError(title, message);
    } catch {
      showInlineFatal(title, message);
    }
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

boot();
