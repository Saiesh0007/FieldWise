# FieldWise — Project Memory & Decision Log (ADRs)

This document captures historical context, Architectural Decision Records (ADRs), hardware integration gotchas, and persistent operational knowledge for future sessions.

---

## 1. Architectural Decision Records (ADRs)

### ADR-001: Direct Browser-to-Autopilot Web Serial API
* **Date:** 2026-09-10
* **Status:** Accepted & Implemented
* **Context:** Traditional UAV GCS setups require native desktop software (Mission Planner, QGroundControl) or an onboard companion computer (Raspberry Pi running MAVROS / MAVLink-router) communicating with the pilot's laptop via UDP/TCP.
* **Decision:** Implement direct USB-to-Pixhawk MAVLink communication using the browser-native W3C Web Serial API (`navigator.serial`).
* **Consequences:**
  * *Pros:* Zero software installation required by the pilot; no Python, ROS, or companion computer setup; runs directly inside Chrome/Edge; highly portable for field tablets.
  * *Cons:* Limited to Chromium-based browsers (Chrome, Edge, Opera, Brave). Firefox and Safari do not support Web Serial.

---

### ADR-002: Local Azimuthal Equidistant (`proj4`) Coordinate Space
* **Date:** 2026-09-12
* **Status:** Accepted & Implemented
* **Context:** Standard Web Mercator ($EPSG:3857$) produces unacceptable spatial distortions at high/low latitudes. Raw spherical geodesic math ($EPSG:4326$) makes fast polygon slicing, parallel buffer offsets, and polygon-difference computations prohibitively slow.
* **Decision:** Dynamically instantiate a custom local Azimuthal Equidistant (AEQD) projection centered at the field's arithmetic mean centroid ($\text{lat}_0 = \text{centroid.lat}$, $\text{lon}_0 = \text{centroid.lon}$) using `proj4`:
  $$\text{`+proj=aeqd +lat_0=}\phi_0\text{ +lon_0=}\lambda_0\text{ +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'}$$
* **Consequences:**
  * *Pros:* True distance preservation from the origin point. Distortion of distances, angles, and areas remains below $0.1\%$ across operational field scales (up to several kilometers). Planar polygon operations (`polygon-clipping`, `@turf/turf`) run at maximum speed.
  * *Cons:* Requires forward projection upon boundary import/walk and inverse projection when rendering to MapLibre or exporting coordinates. Non-invertible at micro-millimeter precision, requiring untouched vertices to be retained directly.

---

### ADR-003: Edge-by-Edge Provenance Tracking
* **Date:** 2026-09-14
* **Status:** Accepted & Implemented
* **Context:** How should the system represent the difference between satellite boundary priors and field-verified boundaries?
* **Decision:** Deconstruct the closed polygon into discrete `BoundaryEdge` segments, each referencing `fromIndex` and `toIndex` vertices and carrying an `EdgeProvenance` record (`kind: 'satellite' | 'walked' | 'confirmed'`, `accuracyM`, `verifiedAt`, `acceptedRisk`).
* **Consequences:**
  * *Pros:* Clear granular visibility into which specific fence lines or tree borders are dangerous priors versus ground truth; enables precise localized GPS walk snapping; provides an auditable safety trail.
  * *Cons:* Edge reconstruction and topological closure must be strictly maintained after any delta splice.

---

### ADR-004: Synchronous Zustand Atomic Recompute
* **Date:** 2026-09-16
* **Status:** Accepted & Implemented
* **Context:** Path replanning, projection updates, and readiness evaluation could be managed via asynchronous Web Workers or multiple React `useEffect` hooks.
* **Decision:** Centralize projection, swath path planning, and readiness evaluation into a single synchronous `recompute()` function inside `useFieldStore.ts`.
* **Consequences:**
  * *Pros:* Guaranteed atomic state updates. No visual flicker or 1-frame race conditions where an old plan appears over a newly walked edge. Benchmark timer demonstrates typical runtimes of $10\text{--}45\text{ ms}$ (well under the $1.5\text{s}$ SLA).
  * *Cons:* Planning executes on the main JS thread; for fields $> 100$ hectares, future optimizations (such as WebAssembly or background worker delegation) may be investigated if execution exceeds $500\text{ ms}$.

---

### ADR-005: Zero-Dependency Embedded MAVLink Codec (14 Messages)
* **Date:** 2026-09-18
* **Status:** Accepted & Implemented
* **Context:** Existing npm MAVLink libraries are either bloated with dozens of unused dialect definitions, target NodeJS stream APIs incompatible with the browser, or lack MAVLink 2.0 packet framing.
* **Decision:** Hand-roll a lean, specialized TypeScript MAVLink 1.0/2.0 encoder/decoder (`src/lib/vehicle/mavlink/`) supporting the 14 essential messages needed for telemetry and mission handshakes:
  `HEARTBEAT`, `SYS_STATUS`, `GPS_RAW_INT`, `ATTITUDE`, `GLOBAL_POSITION_INT`, `MISSION_REQUEST`, `MISSION_REQUEST_LIST`, `MISSION_COUNT`, `MISSION_ITEM_REACHED`, `MISSION_ACK`, `MISSION_REQUEST_INT`, `MISSION_ITEM_INT`, `VFR_HUD`, and `WIND`.
* **Consequences:**
  * *Pros:* Zero external bundle bloat, 100% typed, fully unit-tested byte-by-byte (`codec.test.ts`), supporting full ArduCopter telemetry extraction (battery, altitude, wind, attitude, GPS).
  * *Cons:* New message types must be registered manually with their field offsets and `CRC_EXTRA` seeds.

---

### ADR-006: Client-Side Project Persistence (IndexedDB + Autosave)
* **Date:** 2026-09-20
* **Status:** Accepted & Implemented
* **Context:** Pilots need to save, switch between, and resume multiple field projects without requiring a remote cloud account or server infrastructure (Rule 1).
* **Decision:** Use browser IndexedDB (`fieldwise-projects` database via `projectDb.ts`) to persist `ProjectRecord` instances containing non-derived `ProjectSnapshot` objects. Pair with a 600 ms debounced autosave hook (`useProjectAutosave.ts`) and store active project ID in `localStorage`.
* **Consequences:**
  * *Pros:* Fully offline; comfortably handles large multi-vertex boundaries exceeding `localStorage` size limits; seamless autosave without manual "Save" buttons; idle visits create no empty projects.
  * *Cons:* Private browsing modes may restrict IndexedDB persistence (handled via graceful fallback to transient in-memory state).

---

### ADR-007: Resilient Satellite Tile Protocol (`fwsat://`)
* **Date:** 2026-09-21
* **Status:** Accepted & Implemented
* **Context:** In rural field conditions, satellite tile fetching from Esri can be intermittent, rate-limited, or return static 200 OK "Map data not yet available" placeholder images.
* **Decision:** Register a custom MapLibre protocol (`fwsat://`) that caches loaded tiles in the browser's Cache API (`fieldwise-satellite-tiles-v1`), inspects byte lengths to reject Esri placeholders, and automatically falls back to OpenStreetMap raster tiles upon failure.
* **Consequences:**
  * *Pros:* Re-visiting already-seen ground makes zero network requests; eliminates broken visual placeholder tiles; transparent to MapLibre layers; alerts pilot via status banner.
  * *Cons:* OpenStreetMap fallback is a street/road map rather than aerial photography (clearly indicated in UI).

---

### ADR-008: Plausibility Bounds & Simplification in Delta Corrections
* **Date:** 2026-09-22
* **Status:** Accepted & Implemented
* **Context:** Continuous GPS breadcrumbs or interactive mouse-drag walks generated 100+ points per trim, exploding edge counts. Furthermore, erratic traces could wander deep into the field interior and produce geometrically valid but physically implausible "spikes".
* **Decision:** In `delta.ts`:
  1. Decimate points using Douglas-Peucker with tolerance $\epsilon = \max(2.0\text{ m}, 1.5 \times \text{accuracyM})$.
  2. Enforce a plausibility deviation guard: perpendicular distance from the original edge must not exceed $0.2 \times \text{bounding\_box\_diagonal}$ (min 15 m).
  3. Validate against self-intersections with Turf `kinks`.
  4. Preserve untouched boundary vertices bit-exact from source `LatLng` arrays rather than re-projecting.
* **Consequences:**
  * *Pros:* Boundary edge counts stay manageable (<15 edges); catches wandering interior spikes before damage occurs; eliminates numerical drift on untouched coordinates.
  * *Cons:* Overly aggressive pilot drag paths will be rejected with descriptive error prompts.

---

### ADR-009: Drone Plot-Creation Method (4th AeroGCS Green Method)
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented
* **Context:** AeroGCS Green documents four plot-creation methods (RC/Mobile, Drone, Map, Import KML); FieldWise had the other three but not Drone. A real implementation would use the drone's own live GPS feed to mark each corner as it flies there — not available in a browser demo with no connected aircraft during plot creation.
* **Decision:** Simulate "the drone's current position" as wherever the pilot clicks the map (crosshair cursor + a top banner naming the mode), plus a "Simulate demo" auto-play that walks the sample field's own vertices on a timer, so the method is demoable without hardware. Drone-captured points are ground truth (the pilot/drone was physically at that location when it was marked) — `createBoundary(vertices, 'drone-walk')` gives those edges `'walked'` provenance, the same trust level GPS walk already gets, not `'satellite'`.
* **Consequences:**
  * *Pros:* Completes AeroGCS Green's plot-creation parity; reuses the existing `liveWalkPath` map-visualization and `'walked'`-provenance readiness-gate machinery unchanged, rather than inventing a parallel path for one more input method.
  * *Cons:* "Drone" mode is presently indistinguishable from "click on the map" mode from a data-integrity standpoint — nothing about a captured point proves a real drone was ever involved. A real implementation streaming live GPS from a connected aircraft during plot creation is future work, not built here.
* **Provenance note:** The Import-panel restructuring (2×2 method selector) and this feature's first draft were authored by Antigravity (a different agentic coding tool) in a session outside this one. Reviewing it turned up three real bugs — a `tsc -b`-breaking unused required prop, a React-StrictMode-unsafe nested `setState` call, and UI copy describing a button that doesn't exist in the actual implementation — all fixed and verified with a real headless-browser pass before this ADR was written. Recorded here so a future session doesn't assume external-tool output is correct by default; it wasn't, until checked.

---

### ADR-010: Circle Obstacles as Polygons, Not a Parallel Shape System
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented
* **Context:** AeroGCS Green's Obstacle tool (§12) supports both polygon and circle exclusion shapes. `NoSprayZone` and every downstream consumer (`subtractNoSprayZones`, the planner, exports, map rendering) only ever understood a polygon ring.
* **Decision:** Convert a circle (center + radius) to a closed polygon ring once, at creation/edit time (`lib/geo/circleObstacle.ts`'s `circleToPolygon`, via turf's geodesic `circle()`), and store it as an ordinary `NoSprayZone` with `vertices` as the authoritative geometry. Optional `shape`/`center`/`radiusM` fields ride along purely for the UI ("circle, r=12m") and for Edit Obstacle to re-derive the radius — no other code needs to know a zone was drawn as a circle.
* **Consequences:**
  * *Pros:* Zero changes needed to differencing, planning, export, or map rendering — a circle obstacle is just a `NoSprayZone` everywhere except the two places that care it's a circle (the list label and Edit Obstacle's resize handle).
  * *Cons:* A circle's polygon approximation (32 segments) is a hair smaller in area than a true circle — negligible in practice, verified in `circleObstacle.test.ts`.

---

### ADR-011: Session-Derived Blind vs. Sighted Replay
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented
* **Context:** The Simulate panel originally ran a fixed, scripted scenario (a hardcoded 200m×100m rectangle) rather than replaying the pilot's own session, because `applyWalkedEdgeCorrection` (ADR-008) had nothing keeping the pre-correction boundary once a walk/trim was applied — see the now-superseded rationale that used to live in `blindVsSightedScenario.ts`.
* **Decision:** `useFieldStore` snapshots `originalBoundary` once, whenever a boundary is first created/loaded (Import, "Load sample field", or opening a saved project) — the *same object reference* the live `boundary` starts as. Every correction action (`walkEdge`, `acceptRisk`, `revokeRisk`) only ever reassigns `boundary` to a brand-new object (per ADR-008/`delta.ts`'s "never mutate in place" contract), so `originalBoundary` stays exactly what it was at import time for the session's lifetime, with no special-casing needed to keep it untouched. Persisted in `ProjectSnapshot` too (optional field, falls back to the live boundary for older saved records). `lib/simulation/sessionScenario.ts` holds the pure input-selection logic: `boundaryHasCorrections` (vertex OR provenance divergence) and `runSessionBlindVsSighted` (Blind = plan from `originalBoundary`, Sighted = plan from current `boundary`, both scored against current `boundary` as ground truth). `simulateSprayReplay` (the scoring engine) is untouched — only its inputs changed.
* **Consequences:**
  * *Pros:* An honest, real before/after instead of a scripted stand-in; the empty states ("No field loaded yet" / "No corrections made yet") are simple reference-vs-content checks, not special demo-mode logic.
  * *Cons:* `originalBoundary` doubles the boundary data kept in memory/IndexedDB per session — negligible at field-boundary vertex counts.

---

### ADR-012: Edit Obstacle — Live Local Preview, One Store Commit on Release
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented
* **Context:** AeroGCS Green's Edit Obstacle (§12.3) lets a pilot drag a polygon obstacle's vertex, delete a vertex, or resize a circle by dragging its edge. Every store mutation runs the full `recompute()` pipeline (projection + planner + readiness), so committing on every `mousemove` pixel during a drag would re-plan far more often than needed.
* **Decision:** Mirror the existing pilot-marker-drag pattern (Field-Truth Walk correction): track the in-progress vertex position as local React state in `FieldMap.tsx` (`liveEditVertices`), rendering a live preview of the edited zone's fill/outline/handles from it, and commit to the store (`updateNoSprayZone`) only once, on `mouseup`. A circle's single edge-handle recomputes the whole ring via `circleToPolygon` on every drag frame (locally) so it stays a true circle rather than deforming into an arbitrary polygon.
* **Consequences:**
  * *Pros:* Smooth 60fps drag feedback with only one re-plan per gesture, consistent with the app's existing correction-drag pattern rather than inventing a new one.
  * *Cons:* `liveEditVertices` must be explicitly cleared after each commit (`stopDraggingZoneVertex`) — a first pass missed this and left a stale post-drag snapshot shadowing the store's fresh data for any *subsequent* action (e.g. deleting a different vertex silently no-op'd because the handles were still reading the old array). Caught by a real-browser drag-then-delete pass, not by any unit test, since it's pure React state-lifecycle behavior local to the component.

---

### ADR-013: Manual Plan Editing — Post-Plan Transform, Not a Parallel Planner
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented (partial — see scope note below)
* **Context:** AeroGCS Green's Mission Planning (§11) has 8 sub-features (Parameters, Adjust Waypoint, Adjust Spacing, Indentation, Obstacle Boundary, Route Adjust, Move Plan, Plan Splitting). `planSprayPath` is always called fresh from `boundary`/`noSprayZones`/`droneProfile`/`sweepStrategy` inside `recompute()` (Rule 3's atomic-recompute invariant) — any manual edit that needs to *survive* the next re-plan has to be expressed as one of that function's own inputs, or as a transform applied to its output, not as a one-off mutation of a rendered plan.
* **Decision:** Ship the three sub-features that fit that shape cleanly, defer the rest:
  * **Adjust Spacing** → a new `spacingOverrideM` param on `planSprayPath` itself, used in place of `swathM * (1 - overlapFraction)` when set.
  * **Route Adjust** → no new mechanism at all — it's exactly the existing `sweepStrategy: {kind: 'fixed-heading', headingDeg}` the Plan panel already had; only a slider UI and a (geometry-inert) Head Lock toggle were added.
  * **Move Plan** → a pure post-processing transform, `translateSprayPlan(plan, offset)`, applied once in `recompute()` after `planSprayPath` returns — never touches the boundary or zones, so it composes with everything else for free.
  * **Deferred:** Adjust Waypoint (dragging one generated waypoint is fundamentally a manual override that must survive the *next* re-plan — e.g. a later spacing change — which needs real "diff and reapply" design, not a quick patch); Indentation and Obstacle Boundary spacing (both are legitimate `planSprayPath` inputs — a per-edge inward buffer and a zone buffer, respectively — deferred only for time, not an architectural blocker); Plan Splitting (a %-based route-exclusion display, orthogonal to the above three).
* **Consequences:**
  * *Pros:* All three built features are pure functions/params on the existing pipeline — no special-casing in `recompute()`, no new persistence design, and they compose (a rotated, tightened, and shifted plan all work together, verified in a real browser).
  * *Cons:* `headLock` is presently a stored-but-inert flag — FieldWise has no in-flight heading simulation for it to actually affect. Adjust Waypoint remains the one AeroGCS Green §11 feature that can't be added incrementally; it needs a deliberate design pass on "what a manual override even means" once picked up.

---

### ADR-014: Pi Bridge — a Second `VehicleLink`, Not a Special Case
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented (bridge transport only — see scope note)
* **Context:** This project's actual hardware is a Pixhawk 2.4.8 wired over USB to a Raspberry Pi 4, with no telemetry radio, reached only by SSHing in from a different computer. `WebSerialVehicle` requires the browser and the serial port to be on the same machine (`navigator.serial` has no concept of a *remote* serial port), so it cannot reach this Pixhawk at all — not a bug, a fundamental limit of the Web Serial API. `types.ts` had already anticipated exactly this ("a PiRelayVehicle... is a same-interface drop-in for later if there's time") but nothing had been built.
* **Decision:** Two pieces, matching the project's existing "Hardware Isolation" invariant (Rules.md Rule/Architecture.md §4.3 — UI only ever holds a `VehicleLink`, never a transport directly):
  1. `bridge/serial-ws-bridge.mjs` — a standalone Node.js project (its own `package.json`, not part of the Vite app) that runs on the Pi, opens the Pixhawk's serial port via the `serialport` npm package, and relays raw bytes to exactly one connected WebSocket client at a time (rejecting a second connection, so two ground-station sessions can never send conflicting commands to the same vehicle). It understands nothing about MAVLink — a dumb byte pipe.
  2. `src/lib/vehicle/piRelayVehicle.ts` — a second `VehicleLink` implementation, structurally a near-mirror of `webSerialVehicle.ts` (same `MavlinkSession` plumbing, same `connect`/`disconnect`/`onTelemetry` shape), just swapping `navigator.serial` for a browser `WebSocket`. `SendPanel.tsx` gained a connection-mode toggle (USB / Pi bridge) and a bridge-address field (remembered in `localStorage`) to pick which one to construct.
  * The `ws`/`@types/ws` packages that had sat unused in the *root* `package.json` (the browser never needs a WebSocket **server** library — it has a native `WebSocket` client built in) moved to `bridge/package.json`, where a Node process actually runs one.
  * The bridge got a `--mock` mode: instead of opening a real serial port, it emits a hand-built MAVLink v2 HEARTBEAT frame once a second. The framing/CRC in that mock was cross-verified against this project's own trusted decoder (`MavlinkFrameReader` — the same class `codec.test.ts` already trusts) in a throwaway integration test before being committed, and the full path (bridge → WebSocket → `PiRelayVehicle` → `SendPanel`) was then browser-verified for real: connect via "Pi bridge" mode, see "Connected", see live-decoded telemetry (flight mode, status, heartbeat age) — not a claim taken on faith.
* **Consequences:**
  * *Pros:* Real, working connectivity for this project's actual hardware setup, verified end-to-end without needing the real Pixhawk physically present for this pass. Zero changes to `MavlinkSession` or the codec — the transport swap is entirely below that layer, exactly as the architecture's transport-agnostic design intended.
  * *Cons:* `--mock` only proves the heartbeat/telemetry path; it does not emulate the mission upload/download handshake (`MISSION_COUNT`/`MISSION_REQUEST_INT`/etc.), so "Upload mission" through the bridge is still unverified against anything, real hardware or otherwise — same caveat `webSerialVehicle.ts` already carried for the direct-USB path. The bridge is deliberately unauthenticated (documented loudly in `bridge/README.md`): anyone on the same network who can reach its port can relay MAVLink commands to the real vehicle. Acceptable for a trusted development LAN, not for anything exposed further.

---

## 2. Hardware Gotchas & Field Notes

### Pixhawk 2.4.8 USB Communication
1. **Serial Port Locking:**
   * Only one process can bind a serial port at any time.
   * If Mission Planner, QGroundControl, or the Arduino IDE Serial Monitor has the port open, Chrome's device picker will either fail to list the port or the connection will hang indefinitely.
   * Always close desktop GCS software before clicking **Connect Pixhawk** in FieldWise.
2. **Missing COM Port / Drivers on Windows:**
   * Pixhawk clones typically use CP2102, FTDI, or STM32 Virtual COM port chips.
   * If plugging the USB cable does not register a COM port under Windows Device Manager ("Ports (COM & LPT)"), install the CP210x or STM32 VCP driver.
3. **GPS Acquisition indoors:**
   * GPS modules (u-blox NEO-M8N / M9N) will report `fix_type = 0` (`no-gps`) or `fix_type = 1` (`no-fix`) indoors.
   * 3D fix (`fix_type = 3`) requires clear sky line-of-sight. Allow 30–90 seconds near a window or outdoors for satellite ephemeris download.
4. **HDOP & Telemetry Scaling:**
   * In MAVLink `GPS_RAW_INT`, horizontal dilution of precision (`eph`) is transmitted as an integer scaled by 100. FieldWise decodes this as `eph / 100`. An HDOP $< 2.0$ represents a reliable fix for walk verification.
   * In `SYS_STATUS`, `voltageBattery` is in millivolts; FieldWise decodes as `voltageBattery / 1000.0` V.
   * In `VFR_HUD`, `alt` is barometric/relative altitude in meters.
   * In `WIND`, `direction` is degrees and `speed` is m/s (optional, null when unequipped).
5. **Mission Protocol Scaling & Frames:**
   * Waypoint latitudes and longitudes in `MISSION_ITEM_INT` must be scaled by $10^7$ (`Math.round(lat * 1e7)`).
   * The reference frame must be `MAV_FRAME_GLOBAL_RELATIVE_ALT_INT` (coordinate frame `3`) so altitudes are relative to the home takeoff altitude.

---

## 3. Test Suite & Verification Baseline

* **Command:** `npm test`
* **Test Runner:** Vitest v5.0
* **Status:** 25 test files, 194 tests passing (100% success rate).
* **Key Test Suites:**
  * `project.test.ts`: Validation of project record creation, recency sorting, and snapshot serialization.
  * `scenario.test.ts`: End-to-end integration test of an L-shaped field with pond exclusion, verifying sorties, passes, volumes, and readiness gating.
  * `delta.test.ts`: 17 tests validating point decimation, edge snapping, self-intersection rejection, plausibility thresholds, and provenance updates.
  * `circleObstacle.test.ts`: Circle-to-polygon conversion accuracy (radius, area) and its differencing against a boundary (fully-interior hole, edge-straddling clip) — see ADR-010.
  * `sessionScenario.test.ts`: `boundaryHasCorrections` (vertex and provenance divergence) and `runSessionBlindVsSighted`'s input selection — see ADR-011.
  * `planner.test.ts`: also covers `spacingOverrideM` (row count increases for a tighter override; a non-positive override is rejected rather than looping forever) and `translateSprayPlan` (every pass shifts by the offset, totals unchanged, zero-offset is a no-op) — see ADR-013.
  * `mavlinkSession.test.ts`: Mocked serial loopback testing the MAVLink mission upload handshake and readback verification.
  * `codec.test.ts` & `crc.test.ts`: Validation of MAVLink 2.0 frame packing, CRC-16-CCITT calculations, and `CRC_EXTRA` seeds across all 14 messages.
  * `geocoding.test.ts` & `tileUrl.test.ts`: Tests for Nominatim response parsing and resilient tile URL generation.
