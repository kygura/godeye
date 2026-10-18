# API keys

Every credential the code reads, checked against
`grep -rhoE "process\.env\.[A-Z_]+" server src scripts`. None is required:
`npm run doctor` passes with an empty `.env`, and the app starts on keyless
sources. Add keys through the POWER UP panel or `.env`.

| Variable                                      | Tier                                | Get it                                            | Unlocks                                             | Without it                                                      | Read at                                    |
| --------------------------------------------- | ----------------------------------- | ------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| `AISSTREAM_API_KEY`                           | free, signup                        | https://aisstream.io                              | Live AIS vessels                                    | `/api/ais-live` returns 503, no vessels                         | `server/providers/vessels/ais-live.js`     |
| `FIRMS_MAP_KEY`                               | free, signup                        | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | Active fires                                        | `/api/firms` returns 503, layer empty                           | `server/providers/firms.js`                |
| `TOMTOM_API_KEY`                              | freemium, 200K tiles/month, no card | https://developer.tomtom.com                      | Live traffic flow                                   | Built-in traffic simulation                                     | `server/providers/traffic.js`              |
| `CESIUM_ION_TOKEN`                            | free Community plan, quotas         | https://cesium.com/ion                            | Ion Google 3D, Bing imagery, Cesium World Terrain   | Esri/OSM imagery, keyless terrain                               | `build/vite.js` (browser)                  |
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | free, signup                        | https://opensky-network.org                       | More flight polling credits                         | Anonymous, rate-limited; adsb.lol fallback                      | `server/providers/aircraft/opensky.js`     |
| `OPENSKY_USERNAME` + `OPENSKY_PASSWORD`       | free, signup                        | https://opensky-network.org                       | Basic auth, for `OPENSKY_AUTH_MODE=basic` or `auto` | Same as above                                                   | `server/providers/aircraft/opensky.js`     |
| `LL2_API_TOKEN`                               | free tier, signup                   | https://thespacedevs.com                          | Higher Launch Library 2 allowance                   | Public feed, 15 calls/hour                                      | `server/providers/space/launch-library.js` |
| `TFL_APP_KEY`                                 | free, signup                        | https://api-portal.tfl.gov.uk                     | Higher TfL JamCam list rate limit                   | London cameras still load                                       | `server/providers/cctv/sources.js`         |
| `GOOGLE_MAPS_API_KEY`                         | metered, billing account            | https://console.cloud.google.com                  | Direct Google 3D tiles, Google geocoding            | Ion Google 3D if a Cesium token is set; Photon/Nominatim search | `build/vite.js` (browser)                  |
| `GOOGLE_MAPS_SERVER_API_KEY`                  | metered, billing account            | https://console.cloud.google.com                  | Places search, CCTV Street View fallback            | Falls back to `GOOGLE_MAPS_API_KEY`, else empty results         | `server/providers/places/google-key.js`    |
| `OPENAI_API_KEY`                              | metered                             | https://platform.openai.com                       | Voice control, AI HUD summary                       | Voice off, keyless HUD summary                                  | `server/providers/openai/`                 |

`GOOGLE_MAPS_API_KEY` and `CESIUM_ION_TOKEN` are compiled into the browser
bundle. Restrict them at the provider (see [SECURITY.md](../SECURITY.md)).
Every other key stays on the server.

The POWER UP panel can't set `OPENSKY_USERNAME`, `OPENSKY_PASSWORD`,
`TFL_APP_KEY` or `GOOGLE_MAPS_SERVER_API_KEY`. Put those in `.env`.
