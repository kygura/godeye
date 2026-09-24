import { SceneDirector } from '../scenes/director.js';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { initImageryBoxTool } from '../ui/imageryBoxTool.js';
import { createRecentImageryPanel } from '../ui/recentImagery.js';
import { initGevVoiceCommands } from '../voice/gevRealtime.js';
import { installScopeMask, destroyScopeMask } from '../scopeMask.js';
import { createTravelMode } from '../travel/controller.js';
import { flyToLandmark } from '../locations.js';
import { createCityIntelMode } from '../ui/cityIntelMode.js';
import { createCityIntelPanel } from '../layers/cityIntel/panel.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

/**
 * Attach scene tools, rendering listeners and the application debug handle.
 *
 * Returns `travelMode` (from `src/travel/controller.js`) and `cityIntel`
 * (`{ mode, panel }`, from `src/ui/cityIntelMode.js` and
 * `src/layers/cityIntel/panel.js`) alongside the other components —
 * reachable either from this function's return value (which
 * `application.getComponents().tools.travelMode`/`.cityIntel` surfaces, see
 * `src/app/application.js`) or from `window.__godsEyeView.travelMode`/
 * `.cityIntel`. Call `travelMode.openTravelBriefing({ name, lat, lon })` to
 * open the briefing for an already-resolved place (e.g. a City Intel
 * scorecard's "Brief me").
 */
export function createApplicationTools({
  scene,
  controls,
  data,
  loadingScreen,
  placeSearch,
  voice = {},
  startChrome,
  onSceneDirector,
  sceneDataPacks,
  signal,
  defer,
}) {
  const { viewer, tileset, mapStackController, operations } = scene;
  const { styleManager, weatherEffects, cockpitCloudEffects } = controls;
  const { dataManager } = data;
  const sceneDirector = new SceneDirector(viewer, styleManager, dataManager, {
    dataPacks: sceneDataPacks,
    isMapStackAvailable: (id) =>
      mapStackController?.isStackAvailable(id) === true,
  });
  dataManager.layers
    .get('bhote-koshi-2026')
    ?.module.attachSceneController(sceneDirector);
  defer(() => sceneDirector.destroy());
  onSceneDirector?.(sceneDirector);
  const annotations = initAnnotations({
    viewer,
    tileset,
    placeSearch,
    resolver: operations.annotationResolver,
  });
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
  // DISPLAY ▸ Draw: the same whiteboard, drawn by hand. It claims the pointer
  // while a session is open, so its teardown belongs to the application
  // lifetime rather than to whoever last pressed the button.
  const drawTool = initDrawTool({ viewer, annotations });
  defer(() => drawTool?.destroy());
  // DATA ▸ Recent Imagery: the box tool claims the pointer like Draw and the
  // panel lives on the right rail, so both belong to the application
  // lifetime. The tileset lets the layer drape while the globe is hidden.
  const recentImagery = dataManager.layers.get('recent-imagery')?.module;
  if (recentImagery) {
    recentImagery.attachTileset(tileset);
    const imageryBoxTool = initImageryBoxTool({
      viewer,
      onBox: (box) => recentImagery.setBox(box),
      onCancel: (reason, message, box) => {
        if (message) recentImagery.reportBoxRefusal(message, box);
      },
      onActive: (active) => recentImagery.setToolActive(active),
      // The tool takes Escape in a capture listener, so the panel's order
      // (clear a preview before cancelling the tool) is applied here.
      onEscape: () => recentImagery.clearPreview(),
    });
    // The readout mounts in its rail body through the layer panel, like the
    // weather readout.
    data.presentation.attachRecentImagery((container) =>
      createRecentImageryPanel({
        container,
        viewer,
        layer: recentImagery,
        tool: imageryBoxTool,
      }),
    );
    // The live gate's handle (scripts/qa-recent-imagery.mjs).
    const recentImageryHandle = { layer: recentImagery, tool: imageryBoxTool };
    window.__gevRecentImagery = recentImageryHandle;
    defer(() => {
      if (window.__gevRecentImagery === recentImageryHandle)
        delete window.__gevRecentImagery;
      data.presentation.attachRecentImagery(null);
      imageryBoxTool?.destroy();
    });
  }
  if (startChrome)
    defer(startChrome({ loadingScreen, styleManager, dataManager, signal }));
  const travelMode = createTravelMode({
    viewer,
    styleManager,
    dataManager,
    placeSearch,
    requests: operations.requests,
    signal,
  });
  defer(() => travelMode.destroy());

  // ATLAS (City Intel) mode + ranking panel. docs/cockpit/DESIGN.md, SPEC.md.
  // No ShellFeedback instance is reachable from here (it lives inside
  // whichever shell `startChrome` builds), so this reuses the shared
  // `#toast` element directly — the same element and `.visible` timing
  // `ShellFeedback._showToast` drives, just without that class instance.
  let cityIntelToastTimer = null;
  const showCityIntelToast = (message) => {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(cityIntelToastTimer);
    cityIntelToastTimer = setTimeout(
      () => toast.classList.remove('visible'),
      2000,
    );
  };
  const cityIntelPanel = createCityIntelPanel({
    layer: dataManager.layers.get('city-intel')?.module,
    // Row click flies the camera but never zooms in below 800 km (DESIGN §2);
    // the scorecard's FLY TO action passes its own 600 km range explicitly.
    flyTo: (lat, lon, range = 800_000) =>
      styleManager.runImmediateLocationNavigation(() =>
        flyToLandmark(viewer, lat, lon, { range, pitch: -45, duration: 2 }),
      ),
    showToast: showCityIntelToast,
    // BRIEF ME (DESIGN §6): travelMode is constructed above, before the
    // panel, so its handle is already reachable here.
    travelMode,
  });
  const cityIntelMode = createCityIntelMode({
    dataManager,
    panel: cityIntelPanel,
    showToast: showCityIntelToast,
  });
  defer(() => cityIntelMode.exit());
  const cityIntel = { mode: cityIntelMode, panel: cityIntelPanel };

  // Idle render governor: flips the scene into requestRenderMode whenever
  // nothing animates per frame. Installed AFTER every module above has had
  // its chance to register pre-install holds. (perf wave 2)
  installRenderGovernor(viewer);

  // Install the explicit scope mask used by the DISPLAY controls.
  installScopeMask(viewer);
  defer(() => destroyScopeMask());

  // The follow camera recomputes the tracked target's dead-reckon position
  // every frame — tracking anything is a per-frame animation. (perf wave 2)
  const removeTrackingListener = viewer.trackedEntityChanged.addEventListener(
    () => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    },
  );

  // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
  // stop the default render loop outright — a hidden canvas repaints for
  // nobody, and browser rAF throttling still lets throttled frames burn
  // GPU. Holder/data state is untouched, so return is seamless: restore
  // the loop, refresh the one DOM surface we gated, render a frame.
  const syncVisibilitySuspension = () => {
    const hidden = document.hidden;
    viewer.useDefaultRenderLoop = !hidden;
    cockpitCloudEffects?.setSuspended?.(hidden);
    if (!hidden) {
      data.presentation.flushVisible();
      governorRequestRender('visibility-restore');
    }
  };
  document.addEventListener('visibilitychange', syncVisibilitySuspension);
  defer(() =>
    document.removeEventListener('visibilitychange', syncVisibilitySuspension),
  );
  defer(() => {
    removeTrackingListener();
    releaseContinuousRender('tracked-entity');
  });
  // Apply the CURRENT state too — bootstrap can complete while the tab is
  // already hidden, and waiting for the next transition would leave the
  // loop burning behind a hidden tab. (perf wave 2 fix)
  syncVisibilitySuspension();

  window.__godsEyeView = {
    viewer,
    styleManager,
    tileset,
    dataManager,
    sceneDirector,
    mapStackController,
    annotations,
    weatherEffects,
    cockpitCloudEffects,
    getRenderGovernorDiagnostics,
    surfaceServices: operations.surface,
    requestRender: governorRequestRender,
    travelMode,
    cityIntel,
  };
  const debug = window.__godsEyeView;
  defer(() => {
    if (window.__godsEyeView === debug) delete window.__godsEyeView;
  });
  const voiceCommands = initGevVoiceCommands({
    ...voice,
    floorServices: operations.surface.groundFloor,
    annotationResolver: operations.annotationResolver,
    searchNavigation: operations.searchAndFlyTo,
    signal,
    placeSearch,
    viewer,
    styleManager,
    dataManager,
    sceneDirector,
    annotations,
    cityIntel,
  });
  defer(() => {
    voiceCommands.stop({ removeUi: true });
    if (window.__gevVoiceCommands === voiceCommands)
      delete window.__gevVoiceCommands;
  });
  debug.voiceCommands = voiceCommands;
  return { sceneDirector, annotations, voiceCommands, travelMode, cityIntel };
}
