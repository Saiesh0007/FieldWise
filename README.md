# FieldWise

**"The Drone That Flew Blind"** — field-mapping and spray-path planning that treats a satellite boundary as a dated *prior*, not ground truth.

Agricultural drone operations typically fly against satellite or cadastral boundary polygons that may be months or years old. Real field margins drift — seasonal overgrowth, new hedgerows, a widened stream, a rotated crop line — and a drone that trusts an outdated boundary risks spraying outside the legal envelope or clipping an obstacle. FieldWise treats the satellite boundary as a starting hypothesis: the pilot verifies or corrects it edge-by-edge in the field with lightweight GPS-backed deltas, and the spray path re-plans client-side in well under a second. A flight only clears for upload once every boundary edge is verified or its risk explicitly accepted.

It's an offline-capable, entirely client-side web app — no backend, no cloud dependency for planning or flight control.

## What it does

- **Four ways to define a plot** — walk the perimeter with a phone/RC GPS, click-to-place with a drone, trace on the satellite map, or import GeoJSON/KML.
- **Edge-by-edge verification** — every boundary edge is tagged `satellite` / `walked` / `confirmed`, with a hard readiness gate that blocks flight clearance until every edge is checked or its risk is explicitly accepted.
- **Sub-second client-side replanning** — boustrophedon swath planning (scanline even-odd slicing, heading optimization, no-spray-zone differencing, tank-aware sortie splitting) recomputes in ~10–45ms on every edit.
- **Manual plan editing** — Adjust Spacing, Route Adjust (heading + head lock), Move Plan, and Plan Splitting (fly part of the route now, defer the rest — from the start, from the end, or both sides at once), matching AeroGCS Green's yellow-intended/blue-excluded convention.
- **Flight-path preview** — an animated drone marker flies the actual planned route on the Simulate step, plus a from-scratch replay comparing the boundary as originally imported against the boundary as corrected.
- **Direct MAVLink vehicle link** — a hand-rolled, zero-dependency MAVLink 2.0 codec talks to a real Pixhawk over USB (Web Serial API, no companion software) or through a small Raspberry Pi bridge (serial↔WebSocket) for a no-telemetry-radio, SSH-only setup. Uploads a mission and reads it back to verify; live telemetry (GPS, attitude, battery, wind); Arm/Brake/Resume/RTL/Land flight controls; live mission-progress tracking.
- **Export** — QGroundControl `.plan`, Mission Planner `.waypoints`, GeoJSON, KML, CSV, and a printable pilot handoff/sign-off sheet.
- **Local-first projects** — IndexedDB-backed project records with debounced autosave, no account or server required.

## Stack

- React 19 + TypeScript + Vite, Tailwind v4 (CSS-first config, see `src/index.css`)
- Zustand for app state, with a single synchronous atomic recompute on every edit
- MapLibre GL for the map, `proj4` for a local Azimuthal Equidistant projection (accurate planar geometry near the field), `@turf/turf` + `polygon-clipping` for boundary/zone differencing
- A hand-rolled MAVLink 1.0/2.0 encoder/decoder (`src/lib/vehicle/mavlink/`) — no external MAVLink dependency
- Vitest for unit tests, Oxlint for linting

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build
npm test            # vitest run
npm run lint         # oxlint
```

## Connecting real hardware

See [`VEHICLE_CONNECTION_CHECKLIST.md`](VEHICLE_CONNECTION_CHECKLIST.md) for the step-by-step process of connecting a real Pixhawk (direct USB or via the Raspberry Pi bridge in `bridge/`), verifying live telemetry, and testing mission upload and flight controls safely.

## Project layout

```
src/
  lib/geo/          domain types, projection, planner, edge provenance, delta corrections, readiness (pure functions)
  lib/vehicle/       MAVLink codec, VehicleLink implementations (Web Serial, Pi relay), mission upload/download
  lib/export/        GeoJSON/KML/QGC/Mission Planner/CSV/handoff-sheet exporters
  lib/simulation/     flight-path preview, blind-vs-sighted replay scoring
  lib/storage/        local-first project persistence (IndexedDB)
  store/              Zustand store — app/session state and the atomic recompute pipeline
  components/layout/  app shell, workflow stepper, readiness gate
  components/map/     MapLibre boundary/plan/telemetry rendering
  components/panels/  one panel per workflow step (import/verify/plan/simulate/export/send)
bridge/              standalone Node.js Pixhawk-serial↔WebSocket relay, for a Pi with no telemetry radio
```

## Status

Feature-complete for the core workflow (import → verify → plan → simulate → export → send). The MAVLink protocol logic is unit-tested against a simulated vehicle and has also been verified against real Pixhawk hardware (USB and Raspberry Pi/TELEM2 bridge setups) — mission upload/download, live telemetry, and flight-mode changes all confirmed working end-to-end. Not yet built: automatic sprayer/relay actuation during a mission (the uploaded mission is navigation-only).
