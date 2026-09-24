/** Pure great-circle geometry for trip legs. Coordinates are [lng, lat]. */
const R_EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Beyond this, no commercial nonstop exists; legs are routed via a hub. */
export const MAX_NONSTOP_KM = 14800;

export function haversineKm(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Great-circle points with unwrapped longitudes (no antimeridian jumps). */
export function greatCirclePoints(a, b, steps = 64) {
  const [lon1, lat1, lon2, lat2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (d === 0 || !Number.isFinite(d)) return [a, b];
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x =
      A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y =
      A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))]);
  }
  for (let i = 1; i < pts.length; i++) {
    let lng = pts[i][0];
    const prev = pts[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    pts[i][0] = lng;
  }
  return pts;
}

/**
 * Path for one leg: the great circle when a nonstop is plausible, otherwise
 * via the hub that minimises total distance.
 * @param {[number,number]} a
 * @param {[number,number]} b
 * @param {Array<{coord:[number,number], label:string}>} hubs
 * @returns {{segments:number[][][], distanceKm:number, via?:string}}
 */
export function flightPath(a, b, hubs = []) {
  const direct = haversineKm(a, b);
  if (direct <= MAX_NONSTOP_KM || !hubs.length)
    return { segments: [greatCirclePoints(a, b)], distanceKm: direct };
  let best = null;
  for (const h of hubs) {
    const d1 = haversineKm(a, h.coord);
    const d2 = haversineKm(h.coord, b);
    if (d1 < 500 || d2 < 500 || d1 > MAX_NONSTOP_KM || d2 > MAX_NONSTOP_KM)
      continue;
    if (!best || d1 + d2 < best.total) best = { hub: h, total: d1 + d2 };
  }
  if (!best) return { segments: [greatCirclePoints(a, b)], distanceKm: direct };
  return {
    segments: [
      greatCirclePoints(a, best.hub.coord),
      greatCirclePoints(best.hub.coord, b),
    ],
    distanceKm: best.total,
    via: best.hub.label,
  };
}

/** Rough block time: taxi/climb overhead plus cruise at ~830 km/h. */
export const estimateFlightHours = (km) => 0.6 + km / 830;

/** Rough one-way economy estimate, USD. An estimate, never a quote. */
export const estimateLegCostUSD = (km) => Math.round(45 + 0.11 * km);
