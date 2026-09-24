import { flyToLandmark } from '../locations.js';
import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createCycloneSource } from '../layers/cyclones/source.js';
import { createFirmsSource } from '../layers/firms/source.js';
import { createOpenSkySource } from '../sources/live/standalone.js';
import {
  STATUS_LABELS,
  assessCyclones,
  assessFires,
  assessHelp,
  assessSeismic,
  assessWeather,
  distanceKm,
  formatAge,
  helpPointQuery,
  inNhcCoverage,
  matchFlight,
  normalizeCallsign,
  overallRisk,
  parseTravelParams,
  travelUrl,
} from './briefing.js';

const CONTEXT_LAYERS = ['earthquakes', 'cyclones'];
const STATUS_ICONS = {
  low: 'check_circle',
  moderate: 'info',
  elevated: 'warning',
  high: 'report',
  unavailable: 'help',
  info: 'info',
  loading: 'refresh',
};
const SECTIONS = [
  { id: 'seismic', label: 'Seismic', icon: 'earthquake' },
  { id: 'weather', label: 'Weather', icon: 'partly_cloudy_day' },
  { id: 'cyclones', label: 'Cyclones', icon: 'cyclone' },
  { id: 'fires', label: 'Fires', icon: 'local_fire_department' },
  { id: 'help', label: 'Help', icon: 'local_hospital' },
  { id: 'flight', label: 'My flight', icon: 'flight' },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name) {
  const node = el('span', 'material-symbols-outlined', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function badge(node, status) {
  node.replaceChildren(
    icon(STATUS_ICONS[status]),
    el('span', '', STATUS_LABELS[status]),
  );
  node.dataset.status = status;
}

const timeAgo = (ms) =>
  Number.isFinite(ms) ? formatAge(Date.now() - ms) : 'time unknown';

/** Travel mode: a calm safety briefing that temporarily replaces the spy chrome. */
export function createTravelMode({
  viewer,
  styleManager,
  dataManager,
  placeSearch,
  requests,
  signal,
}) {
  const body = document.body;
  const panel = document.getElementById('travel-panel');
  const toggle = document.getElementById('travel-toggle');
  if (!panel || !toggle) return { destroy() {} };
  const form = document.getElementById('travel-dest-form');
  const input = document.getElementById('travel-dest-input');
  const riskRow = document.getElementById('travel-risk');
  const riskBadge = document.getElementById('travel-risk-badge');
  const riskDetail = document.getElementById('travel-risk-detail');
  const updated = document.getElementById('travel-updated');
  const refresh = document.getElementById('travel-refresh');
  const list = document.getElementById('travel-sections');

  const sources = {
    quakes: createUsgsEarthquakeSource(),
    cyclones: createCycloneSource(),
    fires: createFirmsSource(),
    aircraft: createOpenSkySource(),
  };
  let active = false;
  let saved = null;
  let dest = null;
  let briefing = null;
  let sections = {};
  let fetchedAt = null;
  let callsign = '';
  let flight = { status: 'info', summary: 'Add your flight number' };
  let flightController = null;
  let ticker = null;

  const rows = new Map();
  for (const section of SECTIONS) {
    const item = el('li', 'travel-section');
    const button = el('button', 'travel-row');
    button.type = 'button';
    button.id = `travel-row-${section.id}`;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', `travel-detail-${section.id}`);
    const summary = el('span', 'travel-row-summary');
    const status = el('span', 'travel-badge');
    const chevron = icon('chevron_right');
    chevron.classList.add('travel-chevron');
    const label = el('span', 'travel-row-label');
    label.append(icon(section.icon), el('span', '', section.label));
    button.append(chevron, label, status, summary);
    const detail = el('div', 'travel-detail');
    detail.id = `travel-detail-${section.id}`;
    detail.hidden = true;
    item.append(button, detail);
    list.append(item);
    rows.set(section.id, { item, button, summary, status, detail });
  }

  const setExpanded = (button, detail, expanded) => {
    button.setAttribute('aria-expanded', String(expanded));
    detail.hidden = !expanded;
  };
  const disclosures = () => [
    [riskRow, riskDetail],
    ...[...rows.values()].map(({ button, detail }) => [button, detail]),
  ];

  const flyTo = (lat, lon, range) =>
    styleManager.runImmediateLocationNavigation(() =>
      flyToLandmark(viewer, lat, lon, { range, pitch: -45, duration: 2.5 }),
    );

  const showOnMap = (lat, lon, range, name) => {
    const button = el('button', 'travel-text-btn', 'Show on map');
    button.type = 'button';
    button.setAttribute('aria-label', `Show ${name} on map`);
    button.addEventListener('click', () => flyTo(lat, lon, range));
    return button;
  };

  const detailList = (items, render) => {
    const ul = el('ul', 'travel-items');
    for (const entry of items) {
      const li = el('li', 'travel-item');
      li.append(...render(entry));
      ul.append(li);
    }
    return ul;
  };

  const line = (primary, secondary) => {
    const text = el('div', 'travel-item-text');
    text.append(el('span', 'travel-item-primary', primary));
    if (secondary) text.append(el('span', 'travel-item-secondary', secondary));
    return text;
  };

  const km = (value) =>
    `${value < 10 ? value.toFixed(1) : Math.round(value)} km`;

  function renderDetail(id, section) {
    const detail = rows.get(id).detail;
    const parts = [];
    if (section.status === 'loading')
      parts.push(el('p', 'travel-note', 'Checking this source…'));
    else if (id === 'seismic') {
      parts.push(
        el('p', 'travel-note', 'USGS feed · past 24 h · M2.5+ within 300 km'),
      );
      if (section.items?.length)
        parts.push(
          detailList(section.items.slice(0, 8), (q) => [
            line(
              `M${q.mag.toFixed(1)} · ${km(q.distanceKm)} away`,
              `${q.place || 'Location unnamed'} · ${timeAgo(q.time)}`,
            ),
            showOnMap(q.lat, q.lon, 120_000, `M${q.mag.toFixed(1)} earthquake`),
          ]),
        );
    } else if (id === 'weather') {
      const w = section.weather;
      if (w) {
        const facts = [
          [
            'Feels like',
            Number.isFinite(w.apparentTemperatureC)
              ? `${Math.round(w.apparentTemperatureC)}°C`
              : '—',
          ],
          [
            'Wind',
            Number.isFinite(w.windKph)
              ? `${Math.round(w.windKph)} km/h (${Math.round(w.windKph / 1.852)} kt)`
              : '—',
          ],
          [
            'Precipitation',
            Number.isFinite(w.precipitationMm)
              ? `${w.precipitationMm} mm`
              : '—',
          ],
          [
            'Visibility',
            Number.isFinite(w.visibilityM) ? km(w.visibilityM / 1000) : '—',
          ],
        ];
        const dl = el('dl', 'travel-facts');
        for (const [term, value] of facts)
          dl.append(el('dt', '', term), el('dd', '', value));
        parts.push(
          dl,
          el(
            'p',
            'travel-note',
            `Observed ${timeAgo(Date.parse(w.observedAt))}`,
          ),
        );
      }
    } else if (id === 'cyclones') {
      parts.push(
        el(
          'p',
          'travel-note',
          'NOAA NHC / CPHC · Atlantic and eastern/central Pacific · 500 km radius',
        ),
      );
      if (section.items?.length)
        parts.push(
          detailList(section.items, (s) => [
            line(
              `${s.classification || ''} ${s.name || 'Storm'}`.trim(),
              `${km(s.distanceKm)} at nearest · ${s.windKt ?? '—'} kt winds`,
            ),
            showOnMap(s.lat, s.lon, 1_500_000, s.name || 'storm'),
          ]),
        );
    } else if (id === 'fires') {
      parts.push(
        el(
          'p',
          'travel-note',
          section.status === 'unavailable'
            ? 'Add a NASA FIRMS key in provider settings to check satellite fire detections.'
            : 'NASA FIRMS satellite detections · 50 km radius',
        ),
      );
      if (section.items?.length)
        parts.push(
          detailList(section.items.slice(0, 8), (f) => [
            line(
              `${km(f.distanceKm)} away`,
              `Detected ${f.acqDate || ''} ${f.acqTime || ''}`.trim(),
            ),
            showOnMap(f.lat, f.lon, 20_000, 'fire detection'),
          ]),
        );
    } else if (id === 'help') {
      parts.push(
        el('p', 'travel-note', 'OpenStreetMap · within 10 km · nearest shown'),
      );
      for (const group of section.groups || []) {
        parts.push(
          el('h3', 'travel-group', `${group.label} (${group.points.length})`),
        );
        if (!group.points.length)
          parts.push(el('p', 'travel-note', 'None mapped nearby'));
        else
          parts.push(
            detailList(group.points.slice(0, 3), (p) => [
              line(
                p.name,
                [
                  km(p.distanceKm),
                  p.emergency ? 'emergency dept.' : '',
                  p.phone,
                ]
                  .filter(Boolean)
                  .join(' · '),
              ),
              showOnMap(p.lat, p.lon, 900, p.name),
            ]),
          );
      }
    } else if (id === 'flight') parts.push(...flightDetail());
    if (section.status === 'error')
      parts.push(el('p', 'travel-note', section.error));
    detail.replaceChildren(...parts);
  }

  function flightDetail() {
    const flightForm = el('form', 'travel-dest travel-flight-form');
    const label = el('label', 'travel-visually-hidden', 'Flight callsign');
    label.htmlFor = 'travel-flight-input';
    const field = el('input');
    field.id = 'travel-flight-input';
    field.type = 'text';
    field.placeholder = 'Callsign, e.g. TAP1350';
    field.autocomplete = 'off';
    field.maxLength = 10;
    field.value = callsign;
    const submit = el('button', 'travel-text-btn', 'Find');
    submit.type = 'submit';
    submit.disabled = !dest;
    flightForm.append(label, field, submit);
    flightForm.addEventListener('submit', (event) => {
      event.preventDefault();
      findFlight(field.value);
    });
    const parts = [flightForm];
    parts.push(
      el(
        'p',
        'travel-note',
        'Live position only, no schedule data. Use the ICAO callsign (TAP1350, not TP1350). Keyless coverage is about 250 nm around the destination.',
      ),
    );
    if (flight.match) {
      const m = flight.match;
      const dl = el('dl', 'travel-facts');
      const facts = [
        ['Status', m.onGround ? 'On the ground' : 'Airborne'],
        [
          'Altitude',
          Number.isFinite(m.altitudeM)
            ? `${Math.round(m.altitudeM * 3.281).toLocaleString('en-US')} ft`
            : '—',
        ],
        [
          'Speed',
          Number.isFinite(m.speedMps)
            ? `${Math.round(m.speedMps * 1.944)} kt`
            : '—',
        ],
        ['To destination', km(distanceKm(dest, m))],
      ];
      for (const [term, value] of facts)
        dl.append(el('dt', '', term), el('dd', '', value));
      const track = el('button', 'travel-text-btn', 'Track');
      track.type = 'button';
      track.setAttribute('aria-label', `Track ${m.callsign}`);
      track.addEventListener('click', () => {
        const layer = styleManager.services?.flightsLayer;
        if (!(m.icao24 && layer?.trackById?.(m.icao24, { origin: 'user' })))
          flyTo(m.lat, m.lon, 60_000);
      });
      parts.push(dl, track);
    }
    return parts;
  }

  function renderSection(id, section) {
    const row = rows.get(id);
    row.item.dataset.status = section.status;
    row.summary.textContent = section.summary;
    if (section.status === 'info') row.status.replaceChildren();
    else badge(row.status, section.status);
    renderDetail(id, section);
  }

  function renderOverall() {
    const loading = Object.values(sections).some((s) => s.status === 'loading');
    const overall = overallRisk(sections);
    const status = loading ? 'loading' : overall.status;
    riskRow.dataset.status = status;
    badge(riskBadge, status);
    if (status === 'unavailable') riskBadge.lastChild.textContent = 'Unknown';
    const parts = [
      el(
        'p',
        'travel-note',
        'The overall level is the worst of Seismic, Weather, Cyclones and Fires. Help points and flights are informational.',
      ),
    ];
    if (!loading && overall.drivers.length) {
      const drivers = overall.drivers
        .map((d) => `${d.label}: ${d.reason}`)
        .join('; ');
      parts.push(
        el(
          'p',
          'travel-driver',
          `${STATUS_LABELS[overall.status]} because of ${drivers}.`,
        ),
      );
    }
    if (!loading && overall.notChecked.length)
      parts.push(
        el(
          'p',
          'travel-note',
          `Not checked: ${overall.notChecked.join(', ')}.`,
        ),
      );
    riskDetail.replaceChildren(...parts);
  }

  function renderFreshness() {
    if (!dest) return;
    const place = dest.label;
    updated.textContent = fetchedAt
      ? `${place} · updated ${formatAge(Date.now() - fetchedAt)}`
      : `${place} · checking sources…`;
  }

  function settle(id, run, current) {
    return Promise.resolve()
      .then(run)
      .catch((error) => {
        if (current.signal.aborted) return null;
        return {
          status: 'unavailable',
          summary: 'Source unavailable right now',
          error: String(error?.message || error),
        };
      })
      .then((section) => {
        if (!section || current !== briefing) return;
        sections[id] = section;
        renderSection(id, section);
        renderOverall();
      });
  }

  async function loadBriefing() {
    briefing?.abort();
    if (!dest) return;
    const current = new AbortController();
    briefing = current;
    const scoped = {
      signal: AbortSignal.any([current.signal, signal].filter(Boolean)),
    };
    const loading = { status: 'loading', summary: 'Checking…' };
    sections = {
      seismic: loading,
      weather: loading,
      cyclones: loading,
      fires: loading,
      help: loading,
    };
    for (const [id, section] of Object.entries(sections))
      renderSection(id, section);
    renderSection('flight', flight);
    renderOverall();
    fetchedAt = null;
    refresh.disabled = true;
    renderFreshness();
    const point = dest;
    await Promise.all([
      settle(
        'seismic',
        async () =>
          assessSeismic(await sources.quakes.getSnapshot(scoped), point),
        current,
      ),
      settle(
        'weather',
        async () =>
          assessWeather(
            (await requests.regional.getBrief(point.lat, point.lon, scoped))
              ?.weather,
          ),
        current,
      ),
      settle(
        'cyclones',
        async () =>
          assessCyclones(
            inNhcCoverage(point)
              ? await sources.cyclones.getSnapshot(scoped)
              : null,
            point,
          ),
        current,
      ),
      settle(
        'fires',
        async () => assessFires(await sources.fires.getSnapshot(scoped), point),
        current,
      ),
      settle(
        'help',
        async () =>
          assessHelp(
            await requests.boundaries.query(helpPointQuery(point), scoped),
            point,
          ),
        current,
      ),
    ]);
    if (current !== briefing) return;
    fetchedAt = Date.now();
    refresh.disabled = false;
    renderFreshness();
  }

  async function findFlight(value) {
    callsign = normalizeCallsign(value);
    flightController?.abort();
    if (!callsign || !dest) return;
    const current = new AbortController();
    flightController = current;
    flight = { status: 'loading', summary: `Looking for ${callsign}…` };
    renderSection('flight', flight);
    try {
      const live = styleManager.services?.flightsLayer?.findByQuery?.(callsign);
      let match = null;
      if (live && normalizeCallsign(live.callsign) === callsign)
        match = {
          callsign,
          icao24: live.icao24,
          lat: live.latitude,
          lon: live.longitude,
          altitudeM: live.altitudeM,
          speedMps: live.velocityMps,
          onGround: false,
        };
      else {
        const snapshot = await sources.aircraft.getSnapshot(
          { latitude: dest.lat, longitude: dest.lon },
          { signal: AbortSignal.any([current.signal, signal].filter(Boolean)) },
        );
        const record = matchFlight(snapshot?.records, callsign);
        if (record)
          match = {
            callsign,
            icao24: record.id,
            lat: record.latitude,
            lon: record.longitude,
            altitudeM: record.baroAltitudeM ?? record.ellipsoidAltitudeM,
            speedMps: record.speedMps,
            onGround: record.onGround,
          };
      }
      if (current !== flightController) return;
      flight = match
        ? {
            status: 'info',
            summary: `${callsign} · ${match.onGround ? 'on ground' : 'airborne'}, ${km(distanceKm(dest, match))} away`,
            match,
          }
        : { status: 'info', summary: `${callsign} · not in current coverage` };
    } catch (error) {
      if (current.signal.aborted) return;
      flight = {
        status: 'unavailable',
        summary: `${callsign} · flight data unavailable`,
        error: String(error?.message || error),
      };
    }
    renderSection('flight', flight);
    rows.get('flight').detail.querySelector('input')?.focus();
  }

  async function setDestination(query, { fly = true } = {}) {
    const text = String(query || '').trim();
    if (!text) return;
    briefing?.abort();
    flightController?.abort();
    updated.textContent = `Finding ${text}…`;
    let place = null;
    try {
      ({ place } = await placeSearch.geocode(text, { signal }));
    } catch {
      place = null;
    }
    if (!active) return;
    if (!place) {
      updated.textContent = `Could not find “${text}”. Try a city name.`;
      return;
    }
    const label = place.name || place.label || text;
    dest = { lat: place.lat, lon: place.lng, label };
    input.value = label;
    panel.dataset.ready = '';
    flight = callsign
      ? { status: 'info', summary: `${callsign} · press Find to refresh` }
      : { status: 'info', summary: 'Add your flight number' };
    history.replaceState(
      history.state,
      '',
      travelUrl(location.href, { active: true, dest: text }),
    );
    if (fly) flyTo(dest.lat, dest.lon, 45_000);
    loadBriefing();
  }

  async function enter(query = null) {
    if (active) {
      if (query) await setDestination(query);
      return;
    }
    active = true;
    saved = {
      visual: styleManager.getVisualState(),
      layers: dataManager.getEnabledLayerIds(),
      celestial: styleManager.celestialRingEnabled,
    };
    if (styleManager.cockpitView?.active) styleManager.controlCockpit('exit');
    styleManager.setStyle('normal', { applyPreset: false });
    styleManager.setHudVisible('off');
    styleManager.setDetection({ enabled: false });
    styleManager.setBloom({ enabled: false });
    styleManager.setCelestialRingEnabled(false);
    await styleManager.applyVisualState({ scope: { enabled: false } });
    for (const id of CONTEXT_LAYERS)
      if (dataManager.layers.has(id))
        Promise.resolve(
          dataManager.setEnabled(id, true, { origin: 'user' }),
        ).catch(() => {});
    body.classList.add('travel-mode');
    panel.hidden = false;
    toggle.setAttribute('aria-pressed', 'true');
    history.replaceState(
      history.state,
      '',
      travelUrl(location.href, {
        active: true,
        dest: parseTravelParams(location.search).dest,
      }),
    );
    ticker = setInterval(renderFreshness, 30_000);
    if (query) await setDestination(query);
    else if (dest) {
      renderFreshness();
      loadBriefing();
    } else input.focus();
  }

  async function exit() {
    if (!active) return;
    active = false;
    briefing?.abort();
    flightController?.abort();
    clearInterval(ticker);
    body.classList.remove('travel-mode');
    panel.hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.focus();
    history.replaceState(
      history.state,
      '',
      travelUrl(location.href, { active: false }),
    );
    const restore = saved;
    saved = null;
    await styleManager.applyVisualState(restore.visual);
    styleManager.setCelestialRingEnabled(restore.celestial);
    await dataManager.restoreEnabledLayerIds(restore.layers, {
      origin: 'user',
    });
  }

  const onToggle = () => (active ? exit() : enter());
  const onSubmit = (event) => {
    event.preventDefault();
    setDestination(input.value);
  };
  const onClick = (event) => {
    const button = event.target.closest('.travel-row');
    if (button) {
      const detail = document.getElementById(
        button.getAttribute('aria-controls'),
      );
      setExpanded(
        button,
        detail,
        button.getAttribute('aria-expanded') !== 'true',
      );
    }
    if (event.target.closest('#travel-exit')) exit();
    if (event.target.closest('#travel-refresh')) loadBriefing();
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    const open = disclosures().filter(
      ([button]) => button.getAttribute('aria-expanded') === 'true',
    );
    if (!open.length) return;
    event.preventDefault();
    const focusedRow = open.find(
      ([button, detail]) =>
        detail.contains(document.activeElement) ||
        button === document.activeElement,
    );
    for (const [button, detail] of open) setExpanded(button, detail, false);
    focusedRow?.[0].focus();
  };
  toggle.addEventListener('click', onToggle);
  form.addEventListener('submit', onSubmit);
  panel.addEventListener('click', onClick);
  panel.addEventListener('keydown', onKeyDown);

  const initial = parseTravelParams(location.search);
  if (initial.active) enter(initial.dest);

  return {
    enter,
    exit,
    isActive: () => active,
    destroy() {
      briefing?.abort();
      flightController?.abort();
      clearInterval(ticker);
      toggle.removeEventListener('click', onToggle);
      form.removeEventListener('submit', onSubmit);
      panel.removeEventListener('click', onClick);
      panel.removeEventListener('keydown', onKeyDown);
      list.replaceChildren();
      body.classList.remove('travel-mode');
    },
  };
}
