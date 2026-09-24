import { createTripsLayer } from '../../layers/trips/index.js';
import { tripStore } from '../../travel/tripStore.js';
import * as camera from '../../cameraVerbs.js';

/** Construct the Trips layer over the application camera verbs. */
export function createApplicationTrips() {
  return createTripsLayer({ store: tripStore, camera });
}
