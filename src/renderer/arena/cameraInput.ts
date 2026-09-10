/**
 * Binds arrow keys, middle-mouse drag and the wheel to an `OrbitCamera`.
 *
 * This is the only file in the project that reads user input for the
 * camera, and it is pure view code: it moves angles and a distance, and
 * nothing it touches is ever read by the simulation.
 *
 * ## Surface gotchas this handles
 * A `<canvas>` is not a control by default, so every one of these has to
 * be asked for explicitly or the feature feels broken:
 *
 * - **Wheel** is a passive listener by default in Chromium, and a passive
 *   listener cannot `preventDefault()`. Registered with
 *   `{ passive: false }` so zooming does not also scroll the settings
 *   panel out from under the arena.
 * - **Middle mouse** starts Windows' autoscroll on *pointerdown*, which
 *   hijacks the cursor and paints a scroll widget over the fight.
 *   Cancelled by `preventDefault()` on both `pointerdown` and `auxclick`.
 * - **Context menu** is suppressed only while a drag is live, so a normal
 *   right-click still behaves normally.
 * - **Pointer capture** keeps a free-look going when the cursor leaves
 *   the canvas mid-swing, and `lostpointercapture` guarantees the drag
 *   ends even if the browser takes capture away.
 * - **Arrow keys** scroll the page. Consumed — but only when the arena is
 *   actually on screen and the user is not typing in a field, so arrow
 *   keys keep working normally in the loadout inputs.
 * - Deltas come from `clientX/clientY` differences rather than
 *   `movementX/Y`, which is scaled by OS pointer acceleration and varies
 *   between platforms.
 */
import { CAMERA, OrbitCamera } from './camera';

/** Key names handled here, so the tab's own keymap can avoid them. */
export const CAMERA_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'] as const;

const HELD = {
  left: false, right: false, up: false, down: false,
};

export class CameraInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly cam: OrbitCamera;
  /** Called whenever input moved the camera, so a stopped render loop
   *  can wake up for it — orbiting while paused must still draw. */
  private readonly onInput: () => void;
  /** The arena is only allowed to eat keystrokes while it is on screen. */
  private readonly isLive: () => boolean;

  private readonly held = { ...HELD };
  private dragPointer = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(
    canvas: HTMLCanvasElement,
    cam: OrbitCamera,
    onInput: () => void,
    isLive: () => boolean,
  ) {
    this.canvas = canvas;
    this.cam = cam;
    this.onInput = onInput;
    this.isLive = isLive;

    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('lostpointercapture', this.onPointerUp);
    canvas.addEventListener('auxclick', this.onAuxClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseKeys);
  }

  destroy(): void {
    const c = this.canvas;
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('lostpointercapture', this.onPointerUp);
    c.removeEventListener('auxclick', this.onAuxClick);
    c.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseKeys);
    this.endDrag();
  }

  /** True while the user is actively driving the camera. */
  get active(): boolean {
    const h = this.held;
    return this.dragPointer >= 0 || h.left || h.right || h.up || h.down;
  }

  get dragging(): boolean { return this.dragPointer >= 0; }

  /**
   * Apply whatever arrow keys are held for `dtMs` of wall time. Called
   * once per rendered frame by the renderer — delta-time scaled, so hold
   * speed is identical at 30 fps and at 144.
   */
  applyHeldKeys(dtMs: number): boolean {
    const h = this.held;
    const yawDir = (h.right ? 1 : 0) - (h.left ? 1 : 0);
    const pitchDir = (h.down ? 1 : 0) - (h.up ? 1 : 0);
    if (yawDir === 0 && pitchDir === 0) return false;
    const dt = Math.min(dtMs, 250) / 1000;
    this.cam.rotateBy(
      yawDir * CAMERA.KEY_YAW_DEG_PER_SEC * dt,
      pitchDir * CAMERA.KEY_PITCH_DEG_PER_SEC * dt,
    );
    return true;
  }

  // ----------------------------------------------------------- wheel

  /** No visibility gate: a wheel event is delivered to the canvas because
   *  the cursor is over the canvas, which is proof enough that it is on
   *  screen. Only the window-level key listener needs to check. */
  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // deltaMode 1 is lines, 2 is pages; normalise everything to notches.
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // Wheel-down (positive deltaY) zooms out, as in the client.
    this.cam.zoomBy(-px / CAMERA.WHEEL_PIXELS_PER_NOTCH);
    this.onInput();
  };

  // ------------------------------------------------------ middle drag

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 1 || this.dragPointer >= 0) return;
    // Must happen on pointerdown: this is what stops Windows autoscroll.
    e.preventDefault();
    this.dragPointer = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch { /* capture is a nicety; the drag still tracks without it */ }
    this.canvas.style.cursor = 'grabbing';
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointer) return;
    e.preventDefault();
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    this.cam.dragBy(dx, dy);
    this.onInput();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragPointer) return;
    this.endDrag();
  };

  private endDrag(): void {
    if (this.dragPointer < 0) return;
    try {
      if (this.canvas.hasPointerCapture(this.dragPointer)) {
        this.canvas.releasePointerCapture(this.dragPointer);
      }
    } catch { /* already gone */ }
    this.dragPointer = -1;
    this.canvas.style.cursor = '';
  }

  /** Middle-click also fires `auxclick`; left unhandled it re-arms
   *  autoscroll on some Chromium builds. */
  private readonly onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault();
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.dragging) e.preventDefault();
  };

  // -------------------------------------------------------- keyboard

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.accepts(e)) return;
    switch (e.key) {
      case 'ArrowLeft': this.held.left = true; break;
      case 'ArrowRight': this.held.right = true; break;
      case 'ArrowUp': this.held.up = true; break;
      case 'ArrowDown': this.held.down = true; break;
      case 'Home': this.cam.recentre(); break;
      default: return;
    }
    e.preventDefault(); // arrows would otherwise scroll the page
    this.onInput();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowLeft': this.held.left = false; break;
      case 'ArrowRight': this.held.right = false; break;
      case 'ArrowUp': this.held.up = false; break;
      case 'ArrowDown': this.held.down = false; break;
      default: return;
    }
    e.preventDefault();
  };

  /** Losing focus mid-hold would otherwise spin the camera forever. */
  private readonly releaseKeys = (): void => {
    this.held.left = false;
    this.held.right = false;
    this.held.up = false;
    this.held.down = false;
    this.endDrag();
  };

  private accepts(e: KeyboardEvent): boolean {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return false;
    if (!this.isLive()) return false;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
    return true;
  }
}
