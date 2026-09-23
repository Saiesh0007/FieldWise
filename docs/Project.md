# FieldWise — Project Overview

> **"The Drone That Flew Blind"** — Field-mapping and spray-path planning that treats satellite boundaries as dated *priors*, not ground truth.

---

## 1. Executive Summary

FieldWise is an offline-capable, client-side flight planning and ground verification system engineered for agricultural spray drones. Standard agricultural drone operations rely on pre-existing satellite or cadastral boundary polygons that may be months or years old. In dynamic agricultural environments, real field margins drift due to seasonal overgrowth, waterlogging, shifting hedgerows, new utility poles, or crop rotation boundaries. When drones fly blindly according to outdated satellite boundaries, they risk chemical overspray into neighboring crops, water bodies, or physical collisions with obstacles.

FieldWise fundamentally alters this paradigm:
1. **Satellite as a Prior, Not Ground Truth:** Imported satellite boundaries are treated strictly as an initial hypothesis with explicit edge provenance tracking.
2. **Field-Edge Verification & GPS Delta Corrections:** The field pilot inspects individual boundary edges. If an edge has drifted, the pilot walks the physical edge with a GPS device (or handheld phone) or performs a manual trim. FieldWise merges the delta curve into the polygon in real-time, simplifying walked traces to the GPS accuracy radius and enforcing plausibility bounds.
3. **Sub-Second Client-Side Replanning:** The boustrophedon parallel swath spray plan re-computes completely in the browser in ~10–45 ms without sending spatial data to a cloud server.
4. **Hard Readiness Gate:** A flight plan cannot clear for takeoff or mission upload until every boundary edge has been physically verified or its operational risk has been explicitly signed off.
5. **MAVLink Vehicle Link, Two Transports:** FieldWise connects to Pixhawk autopilots using a lightweight, hand-rolled MAVLink 2.0 protocol engine over either of two interchangeable transports — directly from modern Chromium browsers (Chrome/Edge) over USB via the Web Serial API, or (for a Pixhawk with no telemetry radio, wired to a headless Raspberry Pi reachable only over SSH) through a small Pi-side bridge script relaying the serial stream over a WebSocket. No companion computer software, ROS node, or cloud server required either way.
6. **AeroGCS Green Dashboard Parity & Projects:** Integrated local-first Projects management with IndexedDB autosave, geocoding location search, resilient satellite tile caching with street map toggle, settings menu, and comprehensive live telemetry widgets.

---

## 2. Key Problem Statement

* **The Problem:** Agricultural UAV spray misapplication causes millions in chemical wastage, drift litigation, and crop damage each season. Pilots load KML/Shapefile boundaries exported from GIS databases or satellite tools that do not match the real field on the day of spray.
* **The Vulnerability:** If a field boundary is even 3 meters off along a tree line or stream, an autonomous drone flying at 4–6 m/s with a 4-meter swath spray bar will spray outside the legal envelope or crash into obstacles.
* **The Field Reality:** Connectivity in rural farmlands is unreliable or non-existent. Cloud-dependent replanning tools fail in the field. Pilots need immediate offline feedback on their ruggedized laptops or field tablets.

---

## 3. Core Features & Capabilities

| Feature | Description | Technical Implementation |
| :--- | :--- | :--- |
| **Boundary Ingestion** | Four plot-creation methods (AeroGCS Green parity): RC/Mobile GPS walk, Drone point capture, trace on the satellite map, or import GeoJSON/KML. | `ImportPanel.tsx`, `DronePointCapture.tsx`, `src/lib/geo/importFormats.ts`, `boundary.ts` |
| **Obstacle Tool (Add / Edit / Delete)** | A standalone "Add Obstacle" tool (AeroGCS Green §12) supporting polygon (freehand) and circle (center + radius) exclusion zones, reusing the same no-spray-zone differencing as any other zone. Edit Obstacle lets the pilot drag a polygon vertex to reposition it, select and delete a vertex (3-vertex minimum), or drag a circle's edge to resize it — all live on the map, committed to the store on release. | `ImportPanel.tsx`, `FieldMap.tsx`, `src/lib/geo/circleObstacle.ts` |
| **Global Location Search** | Finds any field worldwide via Nominatim geocoding or browser "use my current location" GPS. | `src/lib/map/geocoding.ts`, `LocationSearch.tsx` |
| **Edge Provenance Tracking** | Deconstructs polygons into discrete edges tagged with provenance: `satellite`, `walked`, or `confirmed`, with `acceptedRisk` flags. | `src/lib/geo/types.ts`, `src/lib/geo/boundary.ts` |
| **Delta Correction Engine** | Splices walked GPS traces or trimmed curves into polygon edges, simplifying to accuracy radius and enforcing plausibility bounds. | `src/lib/geo/delta.ts`, `@turf/turf`, `polygon-clipping` |
| **Local Metric Projection** | Projects WGS84 geographic coordinates to an accurate local Azimuthal Equidistant metric space centered on the field. | `src/lib/geo/projection.ts` using `proj4` (`+proj=aeqd`) |
| **Swath & Sortie Planner** | Boustrophedon sweep planning with scanline even-odd slicing, heading optimization, transit connectors, and sortie constraints. | `src/lib/geo/planner.ts`, `droneProfile.ts` |
| **Manual Plan Editing (AeroGCS Green §11, partial)** | Adjust Spacing (row-spacing override, 2–10m), Route Adjust (heading angle slider + Head Lock toggle), and Move Plan (nudge the generated plan by an accumulated offset, independent of the boundary). | `PlanPanel.tsx`, `src/lib/geo/planner.ts`'s `translateSprayPlan` |
| **Hard Safety Gate** | Evaluates plan readiness: blocks flight clearance and autopilot upload if unverified prior edges exist. | `src/lib/geo/readiness.ts` |
| **Projects System & Autosave** | Local-first project management (create, rename, delete, recency sort) with debounced IndexedDB persistence. | `src/lib/storage/project.ts`, `projectDb.ts`, `useProjectAutosave.ts` |
| **Resilient Map & Tile Cache** | Custom `fwsat://` protocol with Cache API storage, Esri placeholder detection, and automatic OpenStreetMap fallback. | `src/lib/map/resilientSatelliteTiles.ts`, `basemap.ts` |
| **Base Map View Toggle** | Instant in-place toggle between satellite imagery and OpenStreetMap street view without tearing down layers. | `src/lib/map/basemap.ts`, `FieldMap.tsx` |
| **Replay & Scenario Simulator** | Live dual-simulation visualizer comparing "Blind" (the pilot's own boundary as first imported) vs "Sighted" (the pilot's own boundary as currently corrected) — derived from the actual session, not a scripted scenario; scored against the current boundary as ground truth. | `src/lib/simulation/replay.ts`, `sessionScenario.ts` |
| **Multi-Format Mission Export** | Exports missions to QGroundControl (`.plan`), Mission Planner (`.waypoints`), KML, GeoJSON, CSV, and printable handoff sheets. | `src/lib/export/*` |
| **Direct Hardware Link** | MAVLink 2.0 communication engine, transport-agnostic — micro-USB via Web Serial, or a Raspberry Pi bridge (Pixhawk serial → WebSocket) for a no-telemetry-radio, SSH-only Pi setup. | `src/lib/vehicle/mavlink/*`, `webSerialVehicle.ts`, `piRelayVehicle.ts`, `bridge/` |
| **Live Telemetry & Dashboard** | Displays GPS fix, satellites, HDOP, roll/pitch attitude dial, heading compass, battery V/%, altitude AGL, wind speed/direction, and drone center. | `src/components/panels/SendPanel.tsx`, `FieldMap.tsx` |

---

## 4. The 6-Step Pilot Workflow

The application guides the operator through an intuitive 6-stage lifecycle represented in the header stepper:

```
[1. Import] ➔ [2. Verify] ➔ [3. Plan] ➔ [4. Simulate] ➔ [5. Export] ➔ [6. Send to Vehicle]
```

1. **Import:**
   - Search for a field location worldwide with geocoding, use current GPS location, or load the sample field fixture.
   - Choose one of four plot-creation methods via a 2×2 selector, matching AeroGCS Green's dashboard: **RC/Mobile** (walk the perimeter with live GPS), **Drone** (click the map at each corner — simulating the drone's GPS position — or run an auto-play demo), **Map** (trace the boundary on the satellite view), or **Import KML/GeoJSON** (upload a file from any GIS tool).
   - Define exclusion zones (waterways, power lines, houses, ponds) with the **Add Obstacle** tool: draw a freehand **polygon**, or place a **circle** by center + radius. **Edit** an existing obstacle to drag a polygon vertex, delete a selected vertex, or resize a circle by dragging its edge.
2. **Verify (The Core Innovation):**
   - Inspect every polygon boundary edge individually with color-coded provenance (Amber = Satellite Prior, Green = Pilot Walked, Blue = Accepted Risk).
   - "Walk a Strip" or "Trim an Edge" via interactive map drag, real GPS walk, or the mobile walk simulator.
   - One-tap risk acceptance with mandatory rationale capture, or tap two points along visible crop rows to align headings.
3. **Plan:**
   - Configure Drone Profile (Swath width, tank capacity, application rate L/ha, flight speed, battery endurance, altitude, turn penalties).
   - Choose sweep strategy (`min-turns` automatic minimum turns, `fixed-heading`, or `crop-row` alignment) via **Route Adjust** — an angle slider plus a **Head Lock** toggle.
   - **Adjust Spacing** — override the profile-derived row spacing directly (2–10m).
   - **Move Plan** — nudge the entire generated plan by a directional offset, independent of the boundary.
   - Real-time display of total passes, flight distance, chemical volume, flight duration, and sortie counts.
4. **Simulate:**
   - Interactive replay showing the spray drone traversing passes.
   - Comparative playback of "Blind" (the boundary exactly as first imported, snapshotted the moment it was created) versus "Sighted" (the boundary as currently corrected), both scored against the pilot's current boundary as ground truth — a genuine before/after from the pilot's own session, not a scripted example. Reads "No corrections made yet" until at least one edge has actually been walked, trimmed, or risk-accepted.
5. **Export:**
   - Generate standard autopilot files (`.plan` for QGroundControl, `.waypoints` for Mission Planner).
   - Export GIS layers (GeoJSON, KML) and printable pilot-signoff handoff briefing sheets.
6. **Send to Vehicle:**
   - Connect Pixhawk flight controller via USB cable using Web Serial, or via a Raspberry Pi bridge over WebSocket if there's no telemetry radio and the Pi is only reachable over SSH.
   - Verify live telemetry (3D GPS lock, satellites, HDOP, Roll/Pitch artificial horizon, Heading compass, Battery, Altitude, Wind).
   - Upload waypoints directly to Pixhawk via MAVLink mission protocol and verify readback integrity.

---

## 5. Technology Stack Summary

* **Frontend Framework:** React 19, TypeScript (~6.0), Vite 8.
* **Styling & Design System:** Tailwind CSS v4 (CSS-first engine in `src/index.css`), `@fontsource/inter`.
* **Mapping Engine:** MapLibre GL 6.10, custom vector tile and GeoJSON layers, custom `fwsat://` protocol.
* **Geospatial Math & GIS:** `proj4` (Local Azimuthal Equidistant `aeqd`), `@turf/turf`, `polygon-clipping`.
* **State Management & Storage:** Zustand 5.0 with synchronous atomic `recompute()` pipeline, IndexedDB (`fieldwise-projects`), Cache API (`fieldwise-satellite-tiles-v1`).
* **Hardware & Protocols:** Web Serial API (`navigator.serial`) or a Raspberry Pi WebSocket bridge, custom TypeScript MAVLink 1.0/2.0 codec with 14 supported message definitions.
* **Code Quality & Testing:** Vitest (25 suites, 194 tests passing), Oxlint.

---

## 6. Repository Layout

```
FieldWise/
├── docs/                             # Source of truth documentation
│   ├── Project.md                    # Project vision, features, workflow, overview
│   ├── Architecture.md               # System architecture, data flow, pipeline
│   ├── Design.md                     # Algorithms, domain models, protocol specs
│   ├── Rules.md                      # Engineering invariants, coding standards
│   ├── Phases.md                     # Roadmap, development milestones, progress
│   └── Memory.md                     # ADRs, hardware gotchas, operational memory
├── src/
│   ├── components/                   # UI presentation layer
│   │   ├── layout/                   # App shell, stepper, readiness badges, settings menu
│   │   │   ├── AppShell.tsx
│   │   │   ├── ReadinessBadge.tsx
│   │   │   ├── RecomputeTimingBadge.tsx
│   │   │   ├── SettingsMenu.tsx
│   │   │   └── Stepper.tsx
│   │   ├── map/                      # MapLibre GL integration, overlays, mobile simulator
│   │   │   ├── FieldMap.tsx
│   │   │   └── PhoneFrameOverlay.tsx
│   │   ├── panels/                   # Panels per workflow step + project management
│   │   │   ├── DroneProfilePicker.tsx
│   │   │   ├── DronePointCapture.tsx  # "Drone" plot-creation method (click-to-place + auto-play demo)
│   │   │   ├── ExportPanel.tsx
│   │   │   ├── GpsWalkCapture.tsx
│   │   │   ├── ImportPanel.tsx        # 2x2 plot-creation method selector: RC/Mobile, Drone, Map, Import KML
│   │   │   ├── LocationSearch.tsx
│   │   │   ├── PlanPanel.tsx
│   │   │   ├── ProjectsPanel.tsx
│   │   │   ├── SendPanel.tsx
│   │   │   ├── SimulatePanel.tsx
│   │   │   └── VerifyPanel.tsx
│   │   └── ui/                       # Reusable primitives (Button, NumberField, Badges, StatCard, Spinner)
│   ├── hooks/                        # React hooks
│   │   ├── useDroneSimulation.ts     # Drone method's "Simulate demo" auto-play timer
│   │   └── useProjectAutosave.ts     # Debounced project autosave to IndexedDB
│   ├── lib/                          # Pure business and domain logic
│   │   ├── export/                   # Multi-format mission & GIS exporters (+ unit tests)
│   │   │   ├── csv.ts, geojson.ts, kml.ts, qgcPlan.ts, missionPlannerWaypoints.ts, handoffSheet.ts
│   │   ├── geo/                      # Projection, planner, delta math, readiness (+ unit tests)
│   │   │   ├── boundary.ts, circleObstacle.ts, defaults.ts, delta.ts, droneProfile.ts, importFormats.ts,
│   │   │   ├── math.ts, noSprayZones.ts, planner.ts, projection.ts, readiness.ts, sampleField.ts, types.ts
│   │   ├── map/                      # Tile caching, geocoding, basemap toggle, GeoJSON converters
│   │   │   ├── basemap.ts, geocoding.ts, resilientSatelliteTiles.ts, tileUrl.ts, provenanceColors.ts
│   │   ├── simulation/               # Replay scoring engine + session-derived Blind vs. Sighted input selection (+ unit tests)
│   │   │   ├── replay.ts, sessionScenario.ts
│   │   ├── storage/                  # IndexedDB persistence and ProjectRecord operations (+ unit tests)
│   │   │   ├── project.ts, projectDb.ts
│   │   └── vehicle/                  # Web Serial & MAVLink communication stack (+ unit tests)
│   │       ├── mavlinkSession.ts, missionFromPlan.ts, webSerialVehicle.ts, piRelayVehicle.ts, types.ts
│   │       └── mavlink/              # Custom MAVLink codec, CRC calculations, message definitions
│   │           ├── codec.ts, crc.ts, messages.ts
│   │   store/                        # Central Zustand store & atomic recompute pipeline
│   │   ├── useFieldStore.ts
│   ├── App.tsx                       # Main view router & transient interaction controller
│   ├── index.css                     # Tailwind v4 theme & custom utilities
│   └── main.tsx                      # Application bootstrap
├── public/                           # Static assets & icons
├── bridge/                           # Standalone Node project — runs on the Pi, not part of the Vite app
│   ├── serial-ws-bridge.mjs          # Pixhawk serial <-> WebSocket relay (see README.md)
│   ├── package.json
│   └── README.md
├── VEHICLE_CONNECTION_CHECKLIST.md   # Step-by-step physical Pixhawk USB testing guide (USB direct + Pi bridge)
├── package.json                      # Dependencies and scripts
└── vite.config.ts                    # Vite build and dev-server configuration
```
