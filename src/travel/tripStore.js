/**
 * Trips, shortlist and the active trip in one localStorage blob. Same
 * pattern as the Scene Director project: load once, save on every change.
 * Nodes are {cityId, name, lat, lng, iata?}.
 */
import { nextTripColor } from './tripColors.js';

export const STORAGE_KEY = 'gev:travel:v1';

const EMPTY = () => ({ version: 1, trips: [], activeTripId: null, shortlist: [] });

export function createTripStore({ storage = globalThis.localStorage } = {}) {
  let state = load();
  const listeners = new Set();

  function load() {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.trips) && Array.isArray(parsed.shortlist)) return parsed;
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

  return {
    getState: () => state,
    getActiveTrip: active,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    createTrip(name = `Trip ${state.trips.length + 1}`) {
      const t = {
        id: `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        color: nextTripColor(state.trips.map((x) => x.color)),
        nodes: [],
      };
      state.trips.push(t);
      state.activeTripId = t.id;
      commit();
      return t;
    },
    renameTrip(id, name) {
      const t = trip(id);
      if (!t) return false;
      t.name = String(name || t.name);
      commit();
      return true;
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
      if (state.activeTripId === id) state.activeTripId = state.trips.at(-1)?.id ?? null;
      commit();
      return state.trips.length < before;
    },
    /** Append a node to the active trip, creating one when none exists. */
    addNode(node, tripId = state.activeTripId) {
      if (!node || !Number.isFinite(node.lat) || !Number.isFinite(node.lng)) return null;
      let t = trip(tripId);
      if (!t) t = this.createTrip();
      t.nodes.push({ cityId: node.cityId, name: node.name, lat: node.lat, lng: node.lng, iata: node.iata });
      commit();
      return t;
    },
    removeNodeAt(index, tripId = state.activeTripId) {
      const t = trip(tripId);
      if (!t || index < 0 || index >= t.nodes.length) return false;
      t.nodes.splice(index, 1);
      commit();
      return true;
    },
    reorder(from, to, tripId = state.activeTripId) {
      const t = trip(tripId);
      if (!t || from === to || !t.nodes[from] || to < 0 || to >= t.nodes.length) return false;
      const [n] = t.nodes.splice(from, 1);
      t.nodes.splice(to, 0, n);
      commit();
      return true;
    },
    toggleShortlist(cityId) {
      const i = state.shortlist.indexOf(cityId);
      if (i >= 0) state.shortlist.splice(i, 1);
      else state.shortlist.push(cityId);
      commit();
      return i < 0;
    },
  };
}

/** The one browser store; layers and voice actions share it. */
export const tripStore = createTripStore();
