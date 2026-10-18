/**
 * @file ATLAS mode: enter/exit choreography (docs/cockpit/DESIGN.md §1).
 *
 * Layer snapshot/restore reuses the same `dataManager.getEnabledLayerIds()` /
 * `restoreEnabledLayerIds()` pair Travel Mode uses (src/travel/controller.js):
 * entering targets exactly `['city-intel', 'trips']` (restoreEnabledLayerIds
 * disables everything else and enables those two in one call); exiting
 * restores the pre-entry snapshot verbatim, including turning City Intel /
 * Trips back off if they were off before.
 *
 * Panel/rail chrome is a direct DOM class toggle, matching how Travel Mode
 * itself flips `panel.hidden` without routing through PanelChrome's
 * persistence layer — this is a temporary, session-scoped mode view, not a
 * panel layout the user's next visit needs to remember.
 *
 * Entry also grounds the camera (F2 fix — not in DESIGN.md): opening ATLAS
 * from a close-in view (e.g. mid Travel Mode over a street) left the globe
 * showing only the handful of markers near that spot, hiding the ranking's
 * global context. Below `LOW_CAMERA_HEIGHT_M` it flies out to
 * `flyToGlobeView` (`src/locations.js`, the same "reset to globe" helper
 * `resetToGlobeView`/the `zoom_to_globe` voice tool use), which keeps the
 * current sub-camera point centred — same continent, just pulled back.
 * `announceNavigationAuthority` + `interruptCameraMotion` are the
 * dependency-free halves of the authority/cancellation dance the heavier
 * shell-facade routes (`runImmediateLocationNavigation`) compose from; this
 * mode has neither `viewer` nor `styleManager` injected, only
 * `dataManager.viewer`, so it reuses those two directly instead of pulling
 * in the shell. Exit never touches the camera.
 *
 * `enter()` awaits two things (the layer restore, then `panel.ready()`) with
 * real failure modes, and a fast exit()/re-enter() can land while either is
 * still pending. Both are handled the same way `RealtimeConnection` handles
 * a start() superseded by stop() (`src/voice/realtimeConnection.js`): an
 * `enterEpoch` counter that `exit()` bumps, checked after every await, so a
 * superseded `enter()` bails without touching the camera/panel/layers again.
 * A rejected await instead rolls the DOM/layers back to the pre-enter
 * snapshot and rethrows, so first-run/voice callers see the failure instead
 * of a silently-stuck `active`.
 *
 * @module ui/cityIntelMode
 */

import { flyToGlobeView } from '../locations.js';
import { interruptCameraMotion } from '../cameraVerbs.js';
import { announceNavigationAuthority } from '../navigationPolicy.js';

const MODE_CLASS = 'city-intel-mode';
/** F2: fly out to a global view when entry starts below this height. */
const LOW_CAMERA_HEIGHT_M = 3_000_000;
/** DESIGN §1 step 2-3: the only two layers left enabled inside the mode. */
export const MODE_LAYER_IDS = Object.freeze(['city-intel', 'trips']);
/** DESIGN §1 step 4: collapsed on entry; #city-intel-panel expands instead. */
const COLLAPSE_ON_ENTER = Object.freeze([
  'global-context-panel',
  'cctv-panel',
  'scene-panel',
]);
const ENTER_TOAST = 'ATLAS on. Other layers paused until you exit.';
const ENTER_FAIL_TOAST = 'ATLAS could not start. Layers restored.';
const EXIT_TOAST = 'ATLAS off. Layers restored.';
const EXIT_FAIL_TOAST = 'ATLAS off, but layers may not have fully restored.';

/**
 * ATLAS mode controller. Degrades to a no-op when the required DOM (the
 * toggle pill, the panel, the panel's own EXIT button) isn't present, the
 * same defensive shape `createTravelMode` uses.
 * @param {{dataManager: object, panel?: {ready: () => Promise<void>, onModeExit?: () => void}, travelMode?: {isActive: () => boolean, exit: () => Promise<void>}|null, showToast?: (message:string)=>void, doc?: Document}} options
 * @returns {{enter: () => Promise<void>, exit: () => Promise<void>, isActive: () => boolean}}
 */
export function createCityIntelMode({
  dataManager,
  panel = null,
  travelMode = null,
  showToast = () => {},
  doc = typeof document === 'undefined' ? null : document,
} = {}) {
  const body = doc?.body;
  const toggle = doc?.getElementById?.('city-intel-toggle');
  const exitBtn = doc?.getElementById?.('city-intel-exit');
  const panelEl = doc?.getElementById?.('city-intel-panel');
  if (!dataManager || !body || !toggle || !panelEl)
    return {
      enter: async () => {},
      exit: async () => {},
      isActive: () => false,
    };

  let active = false;
  let snapshot = null;
  // Bumped by exit() (never by enter() itself, which only ever runs one
  // attempt at a time behind the `active` guard below) so a pending enter()
  // can tell, after each await, that it was superseded.
  let enterEpoch = 0;

  function setCollapsed(id, collapsed) {
    doc.getElementById(id)?.classList.toggle('collapsed', collapsed);
  }

  function syncChrome() {
    toggle.setAttribute('aria-pressed', String(active));
    if (exitBtn) exitBtn.hidden = !active;
  }

  /** F2: pull the camera out to a global view when entry starts too close in. */
  function flyOutIfLow() {
    const camera = dataManager.viewer?.camera;
    const height = camera?.positionCartographic?.height;
    if (!Number.isFinite(height) || height >= LOW_CAMERA_HEIGHT_M) return;
    announceNavigationAuthority('city-intel-mode-enter');
    interruptCameraMotion('city-intel-mode-enter');
    flyToGlobeView(dataManager.viewer);
  }

  /** Undo enter()'s DOM/chrome — the same reversal exit() has always done. */
  function revertChrome() {
    body.classList.remove(MODE_CLASS);
    setCollapsed('city-intel-panel', true);
    // Loop-2 fix: outside the mode the panel was only ever visually collapsed
    // (still measured by the right rail, still reachable, not wired up) —
    // `hidden` fully excludes it, matching how the rail already treats other
    // conditionally-absent panels (recentImagery.js/weatherPanel.js).
    panelEl.hidden = true;
    active = false;
    syncChrome();
  }

  async function enter() {
    if (active) return;
    active = true;
    const epoch = ++enterEpoch;
    const preSnapshot = dataManager.getEnabledLayerIds();
    snapshot = preSnapshot;
    body.classList.add(MODE_CLASS);
    panelEl.hidden = false;
    setCollapsed('city-intel-panel', false);
    for (const id of COLLAPSE_ON_ENTER) setCollapsed(id, true);
    syncChrome();
    showToast(ENTER_TOAST);
    try {
      await dataManager.restoreEnabledLayerIds(MODE_LAYER_IDS, {
        origin: 'user',
      });
      // exit() (or a newer enter()) may have landed while the above was
      // in flight. Bail without touching the camera/panel — exit() already
      // did its own restore, and racing another one here would just as
      // easily clobber it back to MODE_LAYER_IDS.
      if (epoch !== enterEpoch) return;
      // AFTER the restore, never before: SceneDirector.stopScene() answers
      // every layer-visibility request (src/scenes/director.js, wired
      // through LayerLifecycle._notifyVisibilityRequest) by unconditionally
      // cancelling any in-flight camera animation — a flight started before
      // the restore call above is guaranteed to be killed before it ever
      // renders a frame.
      flyOutIfLow();
      // The layer's own pack load only starts once it is actually enabled
      // (DataManager lazy-inits on first enable), so the panel's `ready()`
      // — which needs `layer.getIndex()` — can only be kicked off from here,
      // not proactively at app boot.
      await panel?.ready?.();
      if (epoch !== enterEpoch) return; // superseded while the panel loaded
    } catch (error) {
      if (epoch !== enterEpoch) return; // exit() already tore this down
      revertChrome();
      snapshot = null;
      try {
        await dataManager.restoreEnabledLayerIds(preSnapshot, {
          origin: 'user',
        });
      } catch (restoreError) {
        console.warn(
          '[ATLAS] Failed to restore layers after a failed enter:',
          restoreError,
        );
      }
      showToast(ENTER_FAIL_TOAST);
      throw error;
    }
  }

  async function exit() {
    if (!active) return;
    enterEpoch++; // invalidate any enter() still in flight
    // DESIGN §11.1: leaving ATLAS while PLAN is showing must restore whichever
    // trip was active before PLAN took over, not strand it as "active".
    panel?.onModeExit?.();
    const restore = snapshot;
    snapshot = null;
    revertChrome();
    if (!restore) {
      showToast(EXIT_TOAST);
      return;
    }
    try {
      await dataManager.restoreEnabledLayerIds(restore, { origin: 'user' });
      showToast(EXIT_TOAST);
    } catch (error) {
      console.warn('[ATLAS] Failed to restore layers on exit:', error);
      showToast(EXIT_FAIL_TOAST);
    }
  }

  // enter() rejects on failure so first-run/voice callers can react (see
  // module doc); the toggle pill itself has already shown the honest toast
  // by then, so the raw click wiring just needs to not surface an unhandled
  // rejection.
  const enterOrExit = () => (active ? exit() : enter().catch(() => {}));
  // DESIGN §6.2: the two full-screen modes are mutually exclusive — clicking
  // ATLAS's pill while Travel Mode is open exits Travel Mode first, then
  // toggles ATLAS, rather than layering one mode's chrome over the other's.
  const onToggleClick = () =>
    travelMode?.isActive?.()
      ? travelMode.exit().then(enterOrExit, enterOrExit)
      : enterOrExit();
  const onExitClick = () => exit();
  toggle.addEventListener('click', onToggleClick);
  exitBtn?.addEventListener('click', onExitClick);
  // DESIGN §1/§9: Escape never exits the mode — it already collapses panels
  // app-wide, and #city-intel-panel is swept into that generic mechanism
  // (PanelChrome binds every `.panel-collapse-btn[data-collapse-target]`
  // found in the DOM at boot). Nothing to bind here.

  return { enter, exit, isActive: () => active };
}
