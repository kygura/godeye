import { createCityIntelLayer } from '../../layers/cityIntel/index.js';

/** Construct the City Intel layer over its bundled pack and live-data source. */
export function createApplicationCityIntel() {
  return createCityIntelLayer();
}
