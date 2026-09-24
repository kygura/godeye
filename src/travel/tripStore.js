/**
 * Trips and the active trip in one localStorage blob. Same pattern as the
 * Scene Director project: load once, save on every change. Nodes are
 * {cityId, name, lat, lng, iata?}.
 */
import { nextTripColor } from './tripColors.js';

export const STORAGE_KEY = 'gev:travel:v1';

const EMPTY = () => ({
  version: 1,
  trips: [],
  activeTripId: null,
});

/** A node needs a finite lat/lng to be usable; everything else passes through. */
function sanitizeNode(node) {
  return node &&
    typeof node === 'object' &&
    Number.isFinite(node.lat) &&
    Number.isFinite(node.lng)
    ? node
    : null;
}

/**
 * Drop a trip that isn't an object with a string id, and drop any node
 * within it that doesn't have a finite lat/lng. Guards against a valid-JSON
 * blob (e.g. hand-edited or from an older/newer version) that would
 * otherwise crash setNodes downstream.
 */
function sanitizeTrip(trip) {
  if (!trip || typeof trip !== 'object' || typeof trip.id !== 'string')
    return null;
  const nodes = Array.isArray(trip.nodes)
    ? trip.nodes.map(sanitizeNode).filter(Boolean)
    : [];
  return { ...trip, nodes };
}

export function createTripStore({ storage = globalThis.localStorage } = {}) {
  let state = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.trips)) {
        const { shortlist: _shortlist, ...rest } = parsed; // retired field, dropped silently
        return {
          ...rest,
          trips: parsed.trips.map(sanitizeTrip).filter(Boolean),
        };
      }
    } catch {
      /* corrupt or blocked storage: start empty */
    }
    return EMPTY();
  }
  function commit() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota or private mode: keep in memory */
    }
    for (const fn of listeners) fn(state);
  }
  const trip = (id) => state.trips.find((t) => t.id === id);
  const active = () => trip(state.activeTripId) || null;
  const planTrip = () => state.trips.find((t) => t.kind === 'plan') || null;

  return {
    getState: () => state,
    getActiveTrip: active,
    /** The single Lifestyle Plan trip (`kind: 'plan'`), or null if never created. */
    getPlanTrip: planTrip,
    /**
     * The Lifestyle Plan trip, creating it (not made active) on first use.
     * @param {string} [name]
     */
    ensurePlanTrip(name = 'Lifestyle plan') {
      let t = planTrip();
      if (t) return t;
      t = {
        id: `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        kind: 'plan',
        color: nextTripColor(state.trips.map((x) => x.color)),
        nodes: [],
      };
      state.trips.push(t);
      commit();
      return t;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setActive(id) {
      if (id !== null && !trip(id)) return false;
      state.activeTripId = id;
      commit();
      return true;
    },
    removeTrip(id) {
      const before = state.trips.length;
      state.trips = state.trips.filter((t) => t.id !== id);
      if (state.activeTripId === id)
        state.activeTripId = state.trips.at(-1)?.id ?? null;
      commit();
      return state.trips.length < before;
    },
    /** Remove every node from a trip without deleting the trip itself. */
    clearTrip(tripId = state.activeTripId) {
      const t = trip(tripId);
      if (!t || !t.nodes.length) return false;
      t.nodes = [];
      commit();
      return true;
    },
    /**
     * Replace a trip's nodes wholesale, one commit. Extra fields on each
     * node (e.g. a Lifestyle Plan stay's `start`/`len`) pass through as
     * given; `kind: 'plan'` trips are kept ordered by `start`.
     * @param {string} tripId
     * @param {object[]} nodes
     * @returns {boolean} false when the trip does not exist
     */
    setNodes(tripId, nodes) {
      const t = trip(tripId);
      if (!t) return false;
      const next = [...(nodes || [])];
      t.nodes =
        t.kind === 'plan' ? next.sort((a, b) => a.start - b.start) : next;
      commit();
      return true;
    },
  };
}

/** The one browser store; layers and voice actions share it. */
export const tripStore = createTripStore();
