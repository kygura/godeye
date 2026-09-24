import { regionalDistanceM, weatherCodeLabel } from '../data/regionalModel.js';

export const STATUS_ORDER = Object.freeze([
  'low',
  'moderate',
  'elevated',
  'high',
]);
export const STATUS_LABELS = Object.freeze({
  low: 'Low',
  moderate: 'Moderate',
  elevated: 'Elevated',
  high: 'High',
  unavailable: 'Not checked',
  info: 'Info',
  loading: 'Checking',
});

export const QUAKE_RADIUS_KM = 300;
export const CYCLONE_RADIUS_KM = 500;
export const FIRE_RADIUS_KM = 50;
export const HELP_RADIUS_KM = 10;

/** Great-circle distance between two `{lat, lon}` points in kilometres. */
export function distanceKm(a, b) {
  return (
    regionalDistanceM(
      { latitude: a?.lat, longitude: a?.lon },
      { latitude: b?.lat, longitude: b?.lon },
    ) / 1000
  );
}

/** Keep rows within `radiusKm` of `origin`, nearest first, each with `distanceKm`. */
export function withinRadius(rows, origin, radiusKm, point = (row) => row) {
  return (rows || [])
    .map((row) => ({ ...row, distanceKm: distanceKm(origin, point(row)) }))
    .filter((row) => row.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

const plural = (count, one, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const km = (value) => `${Math.round(value)} km`;

/** Rules: any M6+ within 300 km is high; M4.5+ within 150 km elevated; any within 300 km moderate. */
export function assessSeismic(quakes, dest) {
  const items = withinRadius(quakes, dest, QUAKE_RADIUS_KM);
  const status = items.some((q) => q.mag >= 6)
    ? 'high'
    : items.some((q) => q.mag >= 4.5 && q.distanceKm <= 150)
      ? 'elevated'
      : items.length
        ? 'moderate'
        : 'low';
  if (!items.length)
    return {
      status,
      summary: `No M2.5+ quakes within ${QUAKE_RADIUS_KM} km`,
      reason: 'no M2.5+ earthquakes in the past 24 hours',
      items,
    };
  const maxMag = Math.max(...items.map((q) => q.mag));
  return {
    status,
    summary: `${plural(items.length, 'quake')}, max M${maxMag.toFixed(1)}, nearest ${km(items[0].distanceKm)}`,
    reason: `${plural(items.length, 'M2.5+ earthquake')} within ${QUAKE_RADIUS_KM} km, largest M${maxMag.toFixed(1)}`,
    items,
  };
}

// ponytail: rough basin box for NHC/CPHC coverage; replace with basin polygons if edge cases matter.
export function inNhcCoverage(dest) {
  return dest.lat >= 0 && dest.lat <= 65 && dest.lon >= -180 && dest.lon <= 5;
}

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > point.lat !== yj > point.lat &&
      point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/** Nearest approach of a storm's position, forecast points or cone to `dest`. */
export function stormDistanceKm(storm, dest) {
  const points = [
    storm.position,
    ...(storm.forecastPoints || []).map((p) => p.position),
  ]
    .filter(Boolean)
    .map((p) => ({ lat: p.latitude, lon: p.longitude }));
  const polygons =
    storm.cone?.type === 'Polygon'
      ? [storm.cone.coordinates]
      : storm.cone?.type === 'MultiPolygon'
        ? storm.cone.coordinates
        : [];
  for (const rings of polygons) {
    if (insideRing(dest, rings[0])) return 0;
    for (const [lon, lat] of rings[0]) points.push({ lat, lon });
  }
  return Math.min(Infinity, ...points.map((p) => distanceKm(dest, p)));
}

/** Rules: storm, cone or forecast within 300 km is high; within 500 km elevated. */
export function assessCyclones(snapshot, dest) {
  if (!inNhcCoverage(dest))
    return {
      status: 'unavailable',
      summary: 'NHC covers Atlantic & E/C Pacific only',
      items: [],
    };
  if (snapshot?.unavailable)
    return {
      status: 'unavailable',
      summary: snapshot.reason || 'Hurricane center feed unavailable',
      items: [],
    };
  const items = (snapshot?.storms || [])
    .map((storm) => ({
      name: storm.name,
      classification: storm.classification,
      windKt: storm.windKt,
      lat: storm.position?.latitude,
      lon: storm.position?.longitude,
      distanceKm: stormDistanceKm(storm, dest),
    }))
    .filter((storm) => storm.distanceKm <= CYCLONE_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (!items.length)
    return {
      status: 'low',
      summary: `No active storms within ${CYCLONE_RADIUS_KM} km`,
      reason: 'no tracked storms nearby',
      items,
    };
  const nearest = items[0];
  return {
    status: nearest.distanceKm <= 300 ? 'high' : 'elevated',
    summary: `${nearest.name || 'Storm'} track within ${km(nearest.distanceKm)}`,
    reason: `${nearest.name || 'a storm'} (position, forecast or cone) within ${km(nearest.distanceKm)}`,
    items,
  };
}

const SEVERE_WEATHER_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 99]);

/** Rules: severe weather code or wind >= 62 km/h is elevated; wind >= 40 km/h or visibility < 1 km moderate. */
export function assessWeather(weather) {
  if (!weather || !Number.isFinite(weather.weatherCode))
    return {
      status: 'unavailable',
      summary: 'No current observation',
      items: [],
    };
  const label = weatherCodeLabel(weather.weatherCode);
  const condition = label.charAt(0) + label.slice(1).toLowerCase();
  const wind = weather.windKph;
  const visibility = weather.visibilityM;
  const reasons = [];
  let status = 'low';
  if (SEVERE_WEATHER_CODES.has(weather.weatherCode) || wind >= 62) {
    status = 'elevated';
    reasons.push(
      SEVERE_WEATHER_CODES.has(weather.weatherCode)
        ? `${condition.toLowerCase()} reported`
        : `wind ${Math.round(wind)} km/h`,
    );
  } else if (wind >= 40 || visibility < 1000) {
    status = 'moderate';
    reasons.push(
      wind >= 40 ? `wind ${Math.round(wind)} km/h` : 'visibility under 1 km',
    );
  }
  const parts = [condition];
  if (Number.isFinite(weather.temperatureC))
    parts.push(`${Math.round(weather.temperatureC)}°C`);
  if (Number.isFinite(wind)) parts.push(`wind ${Math.round(wind)} km/h`);
  return {
    status,
    summary: parts.join(' · '),
    reason: reasons[0] || 'no severe conditions observed',
    items: [],
    weather,
  };
}

/** Rules: any detection within 10 km is high; within 50 km elevated. */
export function assessFires(result, dest) {
  if (result?.keyRequired)
    return { status: 'unavailable', summary: 'Needs FIRMS key', items: [] };
  const items = withinRadius(result?.fires, dest, FIRE_RADIUS_KM);
  if (!items.length)
    return {
      status: 'low',
      summary: `None within ${FIRE_RADIUS_KM} km`,
      reason: 'no satellite fire detections nearby',
      items,
    };
  return {
    status: items[0].distanceKm <= 10 ? 'high' : 'elevated',
    summary: `${plural(items.length, 'detection')}, nearest ${km(items[0].distanceKm)}`,
    reason: `${plural(items.length, 'fire detection')}, nearest ${km(items[0].distanceKm)}`,
    items,
  };
}

export const HELP_KINDS = Object.freeze([
  { id: 'medical', label: 'Hospitals & clinics', one: 'hospital' },
  { id: 'police', label: 'Police', one: 'police station' },
  { id: 'pharmacy', label: 'Pharmacies', one: 'pharmacy', many: 'pharmacies' },
  {
    id: 'embassy',
    label: 'Embassies & consulates',
    one: 'embassy',
    many: 'embassies',
  },
]);

/** Bounded Overpass QL (the proxy caps `around` at 50 km and timeout at 30 s). */
export function helpPointQuery(dest, radiusKm = HELP_RADIUS_KM) {
  const around = `around:${Math.round(radiusKm * 1000)},${dest.lat.toFixed(5)},${dest.lon.toFixed(5)}`;
  return `[out:json][timeout:25];
(
  nwr["amenity"~"^(hospital|clinic|police|pharmacy|embassy)$"](${around});
  nwr["office"="diplomatic"](${around});
);
out center;`;
}

const KIND_BY_AMENITY = {
  hospital: 'medical',
  clinic: 'medical',
  police: 'police',
  pharmacy: 'pharmacy',
  embassy: 'embassy',
};

/** Map one Overpass element to a help point, or null when it has no usable position. */
export function toHelpPoint(element) {
  const tags = element?.tags || {};
  const kind =
    KIND_BY_AMENITY[tags.amenity] ||
    (tags.office === 'diplomatic' ? 'embassy' : null);
  const lat = element?.lat ?? element?.center?.lat;
  const lon = element?.lon ?? element?.center?.lon;
  if (!kind || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const fallback = HELP_KINDS.find((entry) => entry.id === kind).one;
  const name = String(tags['name:en'] || tags.name || '').trim();
  return {
    id: `${element.type || 'node'}/${element.id}`,
    kind,
    name: name || fallback.charAt(0).toUpperCase() + fallback.slice(1),
    phone: tags.phone || tags['contact:phone'] || null,
    emergency: tags.emergency === 'yes',
    lat,
    lon,
  };
}

/** Informational only: help points never raise the overall level. */
export function assessHelp(elements, dest) {
  if (elements?.rateLimited)
    return {
      status: 'unavailable',
      summary: 'Map service busy, try refresh shortly',
      groups: [],
    };
  if (!Array.isArray(elements))
    return {
      status: 'unavailable',
      summary: 'Map service unavailable',
      groups: [],
    };
  const seen = new Set();
  const points = withinRadius(
    elements
      .map(toHelpPoint)
      .filter((p) => p && !seen.has(p.id) && seen.add(p.id)),
    dest,
    HELP_RADIUS_KM,
  );
  const groups = HELP_KINDS.map((kind) => ({
    ...kind,
    points: points.filter((p) => p.kind === kind.id),
  }));
  const [medical, , , embassy] = groups;
  return {
    status: 'info',
    summary: `${plural(medical.points.length, medical.one)}, ${plural(embassy.points.length, embassy.one, embassy.many)} within ${HELP_RADIUS_KM} km`,
    groups,
  };
}

export function normalizeCallsign(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

/** Exact callsign match within an OpenSky-style record list. */
export function matchFlight(records, callsign) {
  const wanted = normalizeCallsign(callsign);
  if (!wanted) return null;
  return (
    (records || []).find((r) => normalizeCallsign(r.callsign) === wanted) ||
    null
  );
}

const SECTION_LABELS = Object.freeze({
  seismic: 'Seismic',
  cyclones: 'Cyclones',
  weather: 'Weather',
  fires: 'Fires',
});

/**
 * Overall level is the worst rated section. Sources that were not checked never
 * raise it; they are listed so the reader knows what the level does not cover.
 */
export function overallRisk(sections) {
  const rated = Object.entries(SECTION_LABELS)
    .map(([id, label]) => ({ id, label, ...sections[id] }))
    .filter((section) => STATUS_ORDER.includes(section.status));
  const notChecked = Object.entries(SECTION_LABELS)
    .filter(([id]) => sections[id]?.status === 'unavailable')
    .map(([, label]) => label);
  if (!rated.length) return { status: 'unavailable', drivers: [], notChecked };
  const rank = Math.max(...rated.map((s) => STATUS_ORDER.indexOf(s.status)));
  const status = STATUS_ORDER[rank];
  return {
    status,
    drivers: rated
      .filter((s) => s.status === status)
      .map((s) => ({ id: s.id, label: s.label, reason: s.reason })),
    notChecked,
  };
}

/** Read `?mode=travel&dest=` from a location search string. */
export function parseTravelParams(search) {
  const params = new URLSearchParams(search || '');
  const dest = String(params.get('dest') || '')
    .trim()
    .slice(0, 120);
  return { active: params.get('mode') === 'travel', dest: dest || null };
}

/** Rewrite the Travel query parameters while keeping path and hash. */
export function travelUrl(href, { active, dest = null }) {
  const url = new URL(href);
  if (active) {
    url.searchParams.set('mode', 'travel');
    if (dest) url.searchParams.set('dest', dest);
    else url.searchParams.delete('dest');
  } else {
    url.searchParams.delete('mode');
    url.searchParams.delete('dest');
  }
  return url.pathname + url.search + url.hash;
}

export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
