# God's Eye View

A 3D globe in the browser for public, live data: aircraft, ships, satellites,
earthquakes, weather, transit and public cameras. This fork adds **ATLAS**, a
city-ranking and lifestyle-planning mode.

Built on [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view).
Vanilla JavaScript, CesiumJS and Vite. Most layers run without API keys.

![Orbital HUD, a tracked live globe, FLIR terrain](docs/media/hero-open-source-reveal.gif)

## Quick start

Requires Node.js 24.x (24.14.0 or later) or 26.x.

```bash
git clone https://github.com/kygura/godeye.git
cd godeye
npm ci
npm run doctor   # checks Node, npm and configured providers
npm run dev
```

Open `http://localhost:4173`. The server binds to localhost only.

With no keys you get Esri satellite imagery, keyless terrain, and every 🟢
layer below. Add keys in the app through the **POWER UP** chip (bottom right,
or `?setup=1`). Keys go to the repo-root `.env`, which Git ignores.

## ATLAS: lifestyle planning

Click the ATLAS pill at the top of the screen, or pick **LIFESTYLE PLANNING**
on first run. ATLAS hides unrelated layers and restores them when you leave.

- **Rank.** Scores 7,903 cities on quality of life, cost, safety and travel
  ease. Drag the weight sliders and the list and globe re-rank live.
- **Compare.** Open a city's scorecard, or put two to four side by side.
  Every metric shows its source, year and whether it is city or country level.
- **Plan.** Build a year of stays. Each stay shows fit, estimated monthly
  cost, a climate heatmap, safety, and a flag when a stay exceeds visa limits
  (Schengen 90/180 included). Stays draw as arcs on the globe.
- **Trips and Travel Mode.** Ad-hoc routes, plus a safety briefing for a
  destination.
- **Voice.** `rank_cities`, `compare_cities`, `show_city_intel`, `plan_lifestyle`.

ATLAS needs no keys. Methodology and known limits:
[docs/cockpit/METHODOLOGY.md](docs/cockpit/METHODOLOGY.md). Design and scope:
[docs/cockpit/SPEC.md](docs/cockpit/SPEC.md).

## Layers

🟢 no key · 🟡 free key · 🔴 metered

| Layer                | What it shows                                                           | Source                           | Key                                         |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| Map stack            | Esri imagery, OSM, Google Photorealistic 3D                             | Esri / OSM / Cesium ion / Google | 🟢 Esri, OSM · 🟡 ion 3D · 🔴 direct Google |
| Flights              | 11,000+ live aircraft with route history                                | OpenSky, adsb.lol                | 🟢                                          |
| Military flights     | ADS-B military traffic                                                  | adsb.lol                         | 🟢                                          |
| Vessels              | Live ships worldwide                                                    | AISStream                        | 🟡                                          |
| Satellites           | 838-object catalog, optional Starlink shell                             | CelesTrak                        | 🟢                                          |
| Earthquakes          | Last 24 hours                                                           | USGS                             | 🟢                                          |
| Traffic              | Simulated vehicles on OSM roads, driven by live flow speeds with TomTom | TomTom, OSM                      | 🟢 sim · 🟡 live flow                       |
| CCTV                 | ~3,600 public cameras projected into the 3D scene                       | City and DOT APIs                | 🟢                                          |
| ALPR cameras         | Plate-reader locations mapped in OSM (locations only)                   | OpenStreetMap                    | 🟢                                          |
| Radio                | Geolocated world radio with a tuner                                     | Radio Browser                    | 🟢                                          |
| Transit              | Live buses, trams, trains and ferries in supported regions              | GTFS-Realtime                    | 🟢                                          |
| Bikeshare            | Station availability                                                    | GBFS                             | 🟢                                          |
| Directions           | Drive, walk or cycle routes with turn-by-turn steps                     | OSRM                             | 🟢                                          |
| Active fires         | FIRMS detections, last 24 hours                                         | NASA FIRMS                       | 🟡                                          |
| Space missions       | Launches from the last 30 days, with a reconstructed ascent replay      | Launch Library 2                 | 🟢                                          |
| Mapped installations | Military sites from community mapping                                   | OpenStreetMap                    | 🟢                                          |
| Wind                 | Animated 10 m forecast wind                                             | NOAA GFS, ECMWF IFS              | 🟢                                          |
| Observed weather     | Radar (US), satellite clouds, lightning on one timeline                 | NOAA nowCOAST                    | 🟢                                          |
| Cyclones             | Positions, forecast tracks and cones                                    | NOAA NHC / CPHC                  | 🟢                                          |
| City Intel (ATLAS)   | Ranked city markers, plan and trip arcs                                 | Bundled pack + keyless proxies   | 🟢                                          |

Bundled static layers: datacenters, dams and submarine cables.

## Controls

`1`–`7` visual styles (CRT, NVG, FLIR and others) · `H` HUD · `D` detection ·
`C` cockpit · `` ` `` frame rate · `Esc` exit.

Click any aircraft, ship or satellite to track it. **COCKPIT** rides a tracked
aircraft in first person.

## Voice

Voice needs an OpenAI key. Click **GEV MIC** and speak: "take me to Tokyo",
"how many flights are over Texas", "outline the state of Texas", "track that
plane". The key stays on the server; the browser gets a short-lived session
token. The app shows session spend, warns at $2 and ends the session at $5.

## API keys

All optional.

| Key              | Enables                                    | Cost                                     | Get it                                                                            |
| ---------------- | ------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------- |
| Cesium ion       | Google Photorealistic 3D and world terrain | 🟡 free for personal, non-commercial use | [cesium.com/ion](https://cesium.com/ion)                                          |
| Google Maps      | Direct Google 3D tiles and place search    | 🔴                                       | [Cloud Console](https://console.cloud.google.com/)                                |
| OpenAI           | Voice and the AI HUD summary               | 🔴 a few cents per active minute         | [platform.openai.com](https://platform.openai.com)                                |
| AISStream        | Ships                                      | 🟡                                       | [aisstream.io](https://aisstream.io)                                              |
| NASA FIRMS       | Fires                                      | 🟡                                       | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/map_key/) |
| TomTom           | Live traffic flow                          | 🟡                                       | [developer.tomtom.com](https://developer.tomtom.com)                              |
| OpenSky          | More flight-polling credits                | 🟡                                       | [opensky-network.org](https://opensky-network.org)                                |
| Launch Library 2 | Higher launch-data allowance               | 🟡                                       | [thespacedevs.com](https://thespacedevs.com)                                      |

Restrict the Google Maps and Cesium ion keys at the provider, since the browser
sees them. You can also set keys as environment variables; see `.env.example`.

## Sharing on a LAN

`npm run dev -- --host 0.0.0.0` exposes the server. Anyone who can reach it
spends your API keys. Set provider quotas and billing alerts first, and read
[SECURITY.md](SECURITY.md).

## Project layout

```
src/
├── main.js        # bootstrap, layer registration
├── ui.js          # panels, HUD, styles
├── voice/         # OpenAI Realtime session and voice tools
├── layers/        # layer components (cityIntel/ is ATLAS)
├── data/          # data modules and bundled datasets
└── scenes/        # scene director
server/            # key-holding proxies, including /api/city-intel/*
```

[docs/CURRENT-STATE.md](docs/CURRENT-STATE.md) is the full runtime reference.

## Scope and disclaimer

GEV models aircraft, vessels, satellites, infrastructure and events. It does
not do face recognition or search for named people, and PRs that add either
will be rejected.

Data can be delayed, modeled or wrong. Do not use GEV for navigation,
emergency response, safety decisions or relocation decisions. ATLAS scores are
a starting point for research.

## License and credits

MIT, see [LICENSE](LICENSE). Bundled and live datasets carry their own terms:
[DATA_SOURCES.md](DATA_SOURCES.md). Upstream project by
[Bilawal Sidhu](https://github.com/bilawalsidhu) and
[Sameh Khamis](https://github.com/samehkhamis). Contributing:
[CONTRIBUTING.md](CONTRIBUTING.md).

<sub>The GIF above shows Google Photorealistic 3D Tiles and is not licensed for
standalone reuse. See [docs/media/README.md](docs/media/README.md).</sub>
