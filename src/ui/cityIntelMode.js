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
 * @module ui/cityIntelMode
 */

const MODE_CLASS = 'city-intel-mode';
/** DESIGN §1 step 2-3: the only two layers left enabled inside the mode. */
export const MODE_LAYER_IDS = Object.freeze(['city-intel', 'trips']);
/** DESIGN §1 step 4: collapsed on entry; #city-intel-panel expands instead. */
const COLLAPSE_ON_ENTER = Object.freeze([
  'global-context-panel',
  'cctv-panel',
  'scene-panel',
]);
const ENTER_TOAST = 'ATLAS on. Other layers paused until you exit.';
const EXIT_TOAST = 'ATLAS off. Layers restored.';

/**
 * ATLAS mode controller. Degrades to a no-op when the required DOM (the
 * toggle pill, the panel, the panel's own EXIT button) isn't present, the
 * same defensive shape `createTravelMode` uses.
 * @param {{dataManager: object, panel?: {ready: () => Promise<void>}, showToast?: (message:string)=>void, doc?: Document}} options
 * @returns {{enter: () => Promise<void>, exit: () => void, isActive: () => boolean}}
 */
export function createCityIntelMode({
  dataManager,
  panel = null,
  showToast = () => {},
  doc = typeof document === 'undefined' ? null : document,
} = {}) {
  const body = doc?.body;
  const toggle = doc?.getElementById?.('city-intel-toggle');
  const exitBtn = doc?.getElementById?.('city-intel-exit');
  const panelEl = doc?.getElementById?.('city-intel-panel');
  if (!dataManager || !body || !toggle || !panelEl)
    return { enter: async () => {}, exit() {}, isActive: () => false };

  let active = false;
  let snapshot = null;

  function setCollapsed(id, collapsed) {
    doc.getElementById(id)?.classList.toggle('collapsed', collapsed);
  }

  function syncChrome() {
    toggle.setAttribute('aria-pressed', String(active));
    if (exitBtn) exitBtn.hidden = !active;
  }

  async function enter() {
    if (active) return;
    active = true;
    snapshot = dataManager.getEnabledLayerIds();
    body.classList.add(MODE_CLASS);
    setCollapsed('city-intel-panel', false);
    for (const id of COLLAPSE_ON_ENTER) setCollapsed(id, true);
    syncChrome();
    showToast(ENTER_TOAST);
    await dataManager.restoreEnabledLayerIds(MODE_LAYER_IDS, {
      origin: 'user',
    });
    // The layer's own pack load only starts once it is actually enabled
    // (DataManager lazy-inits on first enable), so the panel's `ready()`
    // — which needs `layer.getIndex()` — can only be kicked off from here,
    // not proactively at app boot.
    await panel?.ready?.();
  }

  function exit() {
    if (!active) return;
    active = false;
    const restore = snapshot;
    snapshot = null;
    body.classList.remove(MODE_CLASS);
    setCollapsed('city-intel-panel', true);
    syncChrome();
    showToast(EXIT_TOAST);
    if (restore)
      Promise.resolve(
        dataManager.restoreEnabledLayerIds(restore, { origin: 'user' }),
      ).catch(() => {});
  }

  const onToggleClick = () => (active ? exit() : enter());
  const onExitClick = () => exit();
  toggle.addEventListener('click', onToggleClick);
  exitBtn?.addEventListener('click', onExitClick);
  // DESIGN §1/§9: Escape never exits the mode — it already collapses panels
  // app-wide, and #city-intel-panel is swept into that generic mechanism
  // (PanelChrome binds every `.panel-collapse-btn[data-collapse-target]`
  // found in the DOM at boot). Nothing to bind here.

  return { enter, exit, isActive: () => active };
}
