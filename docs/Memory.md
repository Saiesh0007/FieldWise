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

### ADR-015: Live Flight Controls — Arm, Brake, Resume, Land
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented (protocol + UI — real-hardware arming still unverified, see below)
* **Context:** The pilot asked for a slide-to-arm control, a Brake button (their own explicit words: "go in the altitude hold mode"), a Resume button ("resume the mission from where it left"), and a Land button. None of `COMMAND_LONG`, `COMMAND_ACK`, or `SET_MODE` existed in this project's hand-rolled MAVLink codec (`messages.ts`) before this — every message def here has to be added by hand, with its exact field offsets and `CRC_EXTRA`, and a wrong value silently breaks the protocol rather than erroring loudly (see `messages.ts`'s own header comment on this).
* **Decision:**
  * Sourced `COMMAND_LONG`(76), `COMMAND_ACK`(77), and `SET_MODE`(11)'s field layouts and `CRC_EXTRA` from the `mavlink-mappings` npm package (generated from MAVLink's own XML — the same source QGroundControl/Mission Planner/pymavlink are generated from), the same method this file's own messages already used. Cross-checked the 9 pre-existing message defs' `CRC_EXTRA` values against that same source before trusting it for the 3 new ones — all 9 matched exactly, which is what made trusting it for new values reasonable rather than a leap of faith.
  * `MavlinkSession.armDisarm(arm)` sends `COMMAND_LONG` with `MAV_CMD_COMPONENT_ARM_DISARM` (400) and waits for the vehicle's `COMMAND_ACK`, rejecting with the `MAV_RESULT` code if refused (most commonly a failed pre-arm check — this codec doesn't decode `STATUSTEXT`, so the human-readable *reason* isn't available, only the numeric result).
  * `MavlinkSession.setFlightMode(mode)` sends the legacy `SET_MODE` message (still what ArduPilot expects for a GCS-initiated mode change) and waits for the vehicle's *next heartbeat* reflecting the new `custom_mode` — ArduPilot does not `COMMAND_ACK` `SET_MODE`, so a heartbeat is the only real confirmation there is.
  * Brake → ArduCopter's `ALT_HOLD` (2), matching the pilot's own stated intent, not ArduCopter's separately-named `BRAKE` mode (17) — a real distinct mode that does something different (an automatic stop-and-hold flight-controller behavior) from what was actually asked for.
  * Resume → `AUTO` (3). Re-entering `AUTO` after leaving it resumes ArduCopter's loaded mission from its current waypoint index automatically — well-documented ArduCopter behavior — so no `MISSION_SET_CURRENT` message was needed or added.
  * `VehicleLink` gained `armDisarm`/`setFlightMode` as autopilot-detail-free methods (a small `FlightModeCommand` union, not raw ArduCopter mode numbers), implemented identically by both `WebSerialVehicle` and `PiRelayVehicle` since the addition lives entirely in the shared `MavlinkSession`.
  * UI (`SendPanel.tsx`): the arm control is a real drag slider (not a single-tap button) that only fires `armDisarm(true)` at 100% — the drag itself is the confirmation, deliberately with no dialog stacked on top of it (matching the "slide to arm/unlock" pattern's whole point). Disarm and Land each get an explicit `window.confirm` (disarming mid-flight, and aborting a mission to land, are each consequential in their own way); Brake and Resume are single-tap, since gating an emergency-stop-equivalent behind a dialog works against the reason to have the button.
* **Consequences:**
  * *Pros:* Every new byte offset/`CRC_EXTRA` was verified against an authoritative source rather than recalled from memory, and the full path — encode, the simulated-vehicle session logic, and the actual `SendPanel` UI — was verified: 12 new `mavlinkSession.test.ts` cases against a `FakeVehicle`, then a real browser driven end-to-end against a hand-built fake ArduCopter-like WebSocket vehicle (arm → ARMED, Brake → Alt Hold, Resume → Auto, Land → Land, Disarm → Disarmed, all genuinely round-tripping through the real UI, the real `PiRelayVehicle`, and real MAVLink frames).
  * *Cons:* **None of this has touched a real Pixhawk.** `VEHICLE_CONNECTION_CHECKLIST.md` gained a dedicated "Testing Arm/Brake/Resume/Land" section with an explicit propellers-off-first, bench-test-before-flight sequence — this is genuinely the one class of feature in this whole project where "verified in a simulated/mock environment" and "safe to trust with a real vehicle" are not the same claim, and the checklist says so in those words. A rejected arm/mode-change surfaces only a numeric `MAV_RESULT` code, not ArduPilot's own human-readable reason (`STATUSTEXT` isn't decoded) — a known, documented gap, not an oversight.

---

### ADR-016: Start/Finish Points, Plan Splitting, and Live Mission Progress
* **Date:** 2026-09-23
* **Status:** Accepted & Implemented (planning/UI side; upload-subset filtering deferred, see scope note)
* **Context:** Phase 3 of 3 for the pilot's flight-control request. Two related asks: "there should be a start point... and a finish point so that once the drone reaches there the mission is completed 100%," and "add Plan Splitting... so the pilot can optimize battery performance." Neither needed new MAVLink protocol work — `MISSION_ITEM_REACHED` (id 46) had already been a registered message in `messages.ts` since an earlier phase, just never decoded into telemetry.
* **Decision:**
  * `planStartPoint(plan)` / `planFinishPoint(plan)` (`planner.ts`) read the actual flight path's first pass's start and last pass's end — not the boundary's first vertex, which is a different point the existing `home-point` marker already used for the launch/refill marker. Rendered as distinct green/red map markers.
  * `splitPlanPasses(plan, percent, fromEnd)` (`planner.ts`) marks a prefix or suffix of the plan's passes (by pass count, in flight order across every sortie) as "included" vs. "excluded" — a pure filter on an already-generated plan, not a `recompute()` input, so `planSplitPercent`/`planSplitFromEnd` live in the store as plain UI state. The excluded portion renders in blue (`excluded-lines-layer`) over the plan, matching AeroGCS Green's own blue/yellow convention.
  * `MavlinkSession` now decodes `MISSION_ITEM_REACHED` into `telemetry.lastReachedWaypointSeq`. `SendPanel` combines that with the last upload's `uploadedCount` to drive a live progress bar and a "Finish point reached — mission 100% complete" banner — literally what the pilot asked for, built on a message the codec could already parse but had never wired anywhere.
* **Scope cut, deliberate at first, then closed:** "Upload mission" initially still uploaded the *whole* plan regardless of the Plan Splitting slider — deferred rather than risked in the same pass as three other features, since it meant changing `sprayPlanToWaypoints`'s signature (and its one call site) to accept an explicit pass list instead of a whole `SprayPlan`, so it could take either "every pass" or `splitPlanPasses`'s `included` subset. Picked back up the same session and closed: `sprayPlanToWaypoints(passes, projection, altitudeM)` now takes `SprayPass[]`, always renumbers sequence IDs from 0 regardless of which passes were handed in (which is what makes an arbitrary subset a valid mission — the protocol needs contiguous IDs, not the original plan's IDs), and `SendPanel.handleUpload` passes `splitPlanPasses(sprayPlan, planSplitPercent, planSplitFromEnd).included`. At 100% (the default) this is a no-op — every pass is included, same behavior as before. "Resume" in the sense of continuing an interrupted mission is still the flight-controls Resume button (§11.6, see ADR-015), not something Plan Splitting itself does — Plan Splitting's job ends at "which passes get uploaded this sortie."
* **Consequences:**
  * *Pros:* 6 new `planner.test.ts` cases (start/finish point lookup, split at 0%/50%/100% from both directions), a `mavlinkSession.test.ts` case for the new decode, and 4 new `missionFromPlan.test.ts` cases for the upload-filtering change (contiguous renumbering from an arbitrary subset, an empty-list edge case, and that adjacent-pass point-dedup still behaves correctly on a subset) — all pure-function, deterministic. Browser-verified: both markers present on the map (queried via MapLibre's own `queryRenderedFeatures`, not just "should be there"), a 40% split leaving 56 of 139 passes included with 114 excluded lines actually rendered in the blue layer, direction toggle and Reset both confirmed, and — after closing the scope cut — the Send to Vehicle panel's own upload description confirmed reading "Sends only this sortie's 42 of 139 legs" with the split active and correctly reverting to "Sends the current plan's 139 legs" after Reset.
  * *Cons:* Live mission progress has the same real-hardware caveat as ADR-015: `MISSION_ITEM_REACHED` decoding is unit-tested against a simulated vehicle, never received from an actual Pixhawk mid-mission. The mock bridge's `--mock` mode still doesn't emulate the mission-upload handshake, so the split-aware upload path itself is verified by unit test + the UI's own computed description, not (yet) an actual end-to-end upload against any vehicle, real or simulated.

---

### ADR-017: Start/Finish Markers, Plan Splitting Colors & Third Direction — Real Bugs Caught by Actual Use
* **Date:** 2026-09-24
* **Status:** Accepted & Implemented
* **Context:** First real usage feedback on ADR-016's work: "I am just able to see the red point... assume it to be finish point," plus a request to match AeroGCS Green's actual Plan Splitting colors (pasted directly from the manual: "Blue lines... represent areas excluded... yellow lines indicate the intended route"), plus "the plan split feature is bugged ig." Investigating turned up two distinct real issues, not one:
  1. **A genuine visibility bug, not a color problem.** The Start and Finish markers were GeoJSON circle-layer features at `circle-radius: 8`. On the sample field's own boustrophedon path (an odd row count under `min-turns` heading), the last pass ends back at essentially the same corner it started from — so the two markers sat at near-identical coordinates, and whichever layer was added second (Finish, red) simply painted over the first (Start, green) at that pixel. Recoloring alone wouldn't have fixed this — two identical-looking markers stacked on each other is still only one visible marker.
  2. **A real feature gap, not a bug per se.** The manual describes three Plan Splitting directions — "From start," "From end," and "Split Plan From Both Sides" — `splitPlanPasses` only had two (`fromEnd: boolean`). Missing "Both sides" is plausibly what read as "bugged" to someone testing against the manual's own screenshots.
* **Decision:**
  1. Start/Finish switched from two GeoJSON circle layers to two `maplibre-gl` `Marker` instances with a plain DOM element (a 22px green circle, white "S"/"F" text) — both markers now share one color (matching the request), and a DOM marker's stacking is trivially controllable, unlike two coincident GeoJSON point features. More importantly: when the two points are within `MIN_MARKER_SEPARATION_M` (12m) of each other, the Finish marker is nudged sideways — perpendicular to the line between them, in local meters via the existing projection — purely for on-screen legibility; the real mission's finish point (what live-progress tracking checks against) is untouched, only where the marker draws. Deliberately not a MapLibre `symbol` layer with `text-field`: that needs a glyphs server, and this project's map style has none by design (Rule 1, offline-first — no external font-glyph CDN dependency to add for two letters).
  2. `splitPlanPasses`'s `fromEnd: boolean` became `direction: PlanSplitDirection` (`'from-start' | 'from-end' | 'from-both'`), threaded through the store (`planSplitFromEnd` → `planSplitDirection`), `PlanPanel`'s radio group (now three options), `SendPanel`'s upload filter, and `ProjectSnapshot`. `from-both` splits the included percentage evenly across both ends by slicing `[0, half)` and `[total-half, total)` (clamped so the two chunks can never overlap) — "do the two edges of the field now, the middle later" — leaving the single middle chunk excluded.
  3. `spray-lines-layer` recolored from teal-green (`#1a7e69`) to yellow (`#eab308`) — matching the manual's "yellow = intended route" framing for the whole plan, not just an active split's included portion (a plan with nothing excluded is, in that framing, 100% intended). The excluded-passes layer gained a second, wide (10px), semi-transparent (`opacity: 0.35`) underlay beneath its existing solid 3px line, so the "blue overlay" reads as an actual band over the deferred area rather than a thin line easy to miss against satellite imagery — requested in those words ("blue overlay to depict what area of plot is being selected"), not just implied by the manual's plainer "blue lines."
* **Consequences:**
  * *Pros:* 2 new `planner.test.ts` cases for `from-both` (correct chunk placement; no overlap at high percentages — 214 tests total now). Browser-verified after the fix: both DOM markers present (`document.querySelectorAll('.maplibregl-marker')` → 2, text content `["S","F"]`), visibly separated side-by-side in a screenshot where they'd previously fully overlapped, spray lines rendering yellow, excluded lines rendering as a visible blue band, and "Both sides" at 40% correctly splitting into two yellow chunks (start + end) with one blue chunk in the middle.
  * *Cons:* The `MIN_MARKER_SEPARATION_M` nudge is a fixed 12m in local (real-world) meters, not a screen-pixel distance — at a very zoomed-out view, 12m could still be sub-pixel and the markers could visually re-overlap; not fixed, since the app's actual usage is always zoomed to field-detail scale (the same assumption `FieldMap.tsx` already makes elsewhere, e.g. the fit-bounds padding). This is the second round of feedback on a feature built the same day it shipped — a reminder that "verified by browser screenshot" catches what's on screen at the moment of that screenshot, not every geometry a real field can produce (here: a path that returns to its own starting corner), which only showed up once used against the project's own real sample data with fresh eyes.

### ADR-018: Start/Finish Actually Distinct, Mission No Longer Auto-RTLs, RTL Button Added, Simulate's Empty-State Bug
* **Date:** 2026-09-24
* **Status:** Accepted & Implemented
* **Context:** Third round of real-use feedback: "the Continue to stimulate feature is broken," "make sure that the start and finish don't come at same point," and — read together with "if the drone operator wants to bring back the drone to start position he/she may use the RTL button... also add break button so the operator can manually stop the mission" — a request to stop the mission itself from auto-returning home and instead give the pilot an explicit RTL control. Investigating turned up three distinct issues, all in code ADR-016/017 had touched:
  1. **"Continue to Simulate" wasn't actually broken — the map's own empty-state was lying.** `App.tsx` passes `boundary={null}` to `FieldMap` on the Simulate step on purpose (so the live editable boundary layer doesn't render underneath the replay overlay), but `FieldMap`'s "No field loaded yet" placeholder keyed off that same `!boundary` check. Land on Simulate before running a replay (e.g. no boundary corrections exist yet to compare) and the map claims no field is loaded at all — even though one plainly is, and the panel's own text says something quite different ("No corrections made yet"). Confusing enough to read as broken.
  2. **ADR-017's 12m marker nudge was a band-aid over a real geometric bug, not a rendering quirk.** `splitIntoSorties` (`droneProfile.ts`) always opens a sortie with a non-spraying transit leg out from the home/refill point and always closes one with a transit leg back to home (needed for correct distance/time accounting of the refill round trip). `planStartPoint`/`planFinishPoint` were reading the literal first and last pass in `plan.sorties` — which are exactly those two transit legs. So Start and Finish weren't just "close together" on some field geometries, they were **the same point, always**, for every plan with any route length worth spraying, and the 12m nudge in ADR-017 was hiding that rather than fixing it.
  3. **Consequence of the same bug: every mission upload silently auto-returned home.** `sprayPlanToWaypoints` converted every pass — including those bookending transit legs — into real `NAV_WAYPOINT` items, so the vehicle's last scripted waypoint was always the home point. There was no way to upload a route that *doesn't* fly home at the end, and no RTL button to make "go home" a deliberate action instead.
* **Decision:**
  1. `FieldMap` gained a `fieldLoaded` prop, defaulting to `boundary !== null` but settable independently — `App.tsx` now passes `fieldLoaded={boundary !== null}` unconditionally (the *real* boundary, not the per-step nulled one) alongside the existing step-conditional `boundary` prop. The "No field loaded yet" placeholder now keys off `fieldLoaded`, not `boundary`, so it only ever appears when a field genuinely isn't loaded.
  2. `planStartPoint`/`planFinishPoint` now search for the first/last pass with `spraying: true` in flight order, skipping the bookending transit legs entirely — giving the route's actual endpoints, which are essentially never the same point for a real multi-row plan (added a test asserting exactly that, rather than just the coincidental value each returns).
  3. `sprayPlanToWaypoints` now trims a leading and/or trailing run of non-spraying passes before building the waypoint list (a mid-route transit leg — crossing a no-spray zone, or between disjoint concave segments — is left alone; only the outermost bookending legs are dropped). The uploaded mission's last waypoint is now the last real spray point, not home.
  4. Added `'rtl'` to `FlightModeCommand` (ArduCopter custom mode 6, already labeled in `ARDUCOPTER_MODE_LABELS`) and a fourth flight-control button in `SendPanel` (Brake / Resume / RTL / Land, now a 2×2 grid) — RTL is now the pilot's explicit way to bring the vehicle back to the launch point, since the mission itself no longer does it automatically.
* **Consequences:**
  * *Pros:* The Start/Finish fix is a real geometric correction, not a visual workaround — ADR-017's 12m nudge stays in `FieldMap.tsx` as a defensive fallback but should now be structurally unreachable for any plan with more than a trivial amount of route. 4 new/updated tests (`missionFromPlan.test.ts`'s bookend-trimming cases, `planner.test.ts`'s "never the same point" case) — 217 tests total now. Browser-verified: Simulate's map no longer shows the empty-state card before a replay has run; Plan step's S/F markers now sit at opposite ends of the route rather than 12m apart at the same corner; RTL renders and is wired identically to the existing Brake/Resume/Land pattern (same confirm-dialog treatment as Land, since it's equally mission-ending).
  * *Cons:* Same real-hardware caveat as ADR-015/016 — RTL's mode-change plumbing is exercised by the existing generic `setFlightMode` test coverage (mode number in, heartbeat echo out) but never against a real Pixhawk. Dropping the bookending transit legs from the uploaded mission is a behavior change for anyone who *was* relying on the implicit auto-return-home at the end of a mission — now genuinely requires either RTL or a manually re-added return leg; not considered a regression here since it's exactly what was asked for, but worth remembering if a future report says a vehicle "just stopped" at the last spray point instead of coming home on its own.

### ADR-019: Simulate's Flight Preview (Animated Drone, Start-to-Finish), Simulate-Scoped Brake/RTL, Plot Colors
* **Date:** 2026-09-24
* **Status:** Accepted & Implemented
* **Context:** Fourth round of feedback, building directly on ADR-018: "the drone must move from start to finish with intended plan," "the rtl button break button should be visible in the simulate section only," "the drone should be shown as blue arrow," and separately, "after creating the plot, the color is light green, I want it blue and the plot boundary color should be yellow." Two distinct asks:
  1. Simulate's existing content (Blind vs. Sighted replay) is a heatmap-coverage comparison, not a flight-path animation — there was no moving drone anywhere in the app, on any step. "Brake" and "RTL" already existed, but only in Send to Vehicle, gated behind a real (or dev-seeded) vehicle connection — not something a pilot could use to rehearse a route before ever connecting hardware, which is what "visible in the simulate section only" was actually asking for: a rehearsal-scoped Brake/RTL, independent of live telemetry.
  2. The boundary fill (`boundary-fill-layer`) had been `#279d82` (a teal that reads as light green against satellite imagery) since long before this session's other color work; ADR-017 recolored the *spray plan's* lines to yellow/blue but never touched the boundary polygon itself, and there was no boundary outline at all outside the Verify step's per-edge provenance colors (walked/satellite/confirmed/accepted) — so "the plot boundary" had no consistent, always-visible color to begin with.
* **Decision:**
  1. New pure module `lib/simulation/flightPreview.ts` (`buildFlightPath`, `poseAtDistance`, `totalFlightPathLengthM`) turns a plan's passes into a cumulative-distance path and answers "where is the drone, and which way is it facing, after flying N meters" — no timers, no React; `SimulatePanel` owns the animation clock (a 70ms tick, same cadence as the existing heatmap reveal) and advances a `previewDistanceM` state value toward the path's total length over a fixed 18s regardless of the route's real-world length (a 13km plan at real drone speed would take the better part of an hour — not a usable on-screen preview). The path itself is built from `trimBookendingTransitLegs` (exported from `missionFromPlan.ts`, see ADR-018) over every sortie's passes, so the preview flies the exact route the mission would upload — Start to Finish, the same S/F markers already on Plan.
  2. `FieldMap` gained a `dronePosition` prop (`{ lat, lon, headingDeg } | null`) and a new `maplibre-gl` `Marker` — a blue (`#2563eb`) SVG arrow, rotated via `Marker.setRotation(headingDeg)` (compass bearing, matching `VFR_HUD.heading`'s convention) — kept in its own effect/ref, entirely separate from the green Start/Finish markers. `App.tsx` only ever passes a non-null position on the Simulate step (`currentStep === 'simulate' ? dronePreviewPosition : null`), and `SimulatePanel` clears it on unmount the same way it already clears `simulateOverlay`.
  2a. **Same-session correction:** the first cut of this ADR still nulled `sprayPlan` (and left `showPlan` false) on the Simulate step — inherited from before the flight preview existed, when there was nothing plan-related to show there. That meant the yellow spray-route lines and the S/F markers were invisible on Simulate, directly contradicting the panel's own copy ("the same intended path (yellow, in Plan)") and the immediate follow-up report ("The yellow lined route should be visible"). Fixed by passing the real `sprayPlan` unconditionally and adding `'simulate'` to `showPlan`'s step list (`App.tsx`) — `boundary` stays nulled on Simulate as before (ADR-018's `fieldLoaded` fix still applies), since that's about the *editable* boundary layer, an unrelated concern from the plan's own lines.
  3. New "Flight preview" section in `SimulatePanel`, above the existing Blind vs. Sighted replay, with Play/Pause, **Brake** (pauses in place, disabled unless playing), **RTL** (resets to distance 0, i.e. back to Start), and a scrub slider — all local component state, entirely independent of `SendPanel`'s identically-named buttons and never rendered there. A fresh plan auto-starts the preview playing from Start, matching "the drone must move from start to finish" as default behavior rather than something the pilot has to trigger.
  4. `boundary-fill-layer`'s `fill-color` changed from `#279d82` to `#2563eb` (blue). A new always-on `boundary-plain-outline-layer` (yellow, `#eab308`, on the same `boundary-fill` source rendered as a `line` layer) was added for the boundary's outline — visible on every step except Verify, where it's hidden in favor of the existing per-edge provenance colors (walked/satellite/confirmed/accepted), which carry meaning the plain yellow wouldn't. On Plan/Export, this outline is the same yellow as the spray-plan's own "intended route" lines from ADR-017 — a deliberate, if slightly redundant-looking, consequence of both being told to be yellow in the same conversation; not fixed differently since that's what was asked for both times.
* **Consequences:**
  * *Pros:* 8 new tests (`flightPreview.test.ts`) — 225 total now. Browser-verified: the blue arrow renders and visibly moves/rotates across two screenshots 4 seconds apart (302m → 2967m of 12931m flown); Brake/RTL text is present on Simulate and absent on Plan; `boundary-fill-layer`'s paint and `boundary-plain-outline-layer`'s color/visibility read back exactly as set via `map.getPaintProperty`/`getLayoutProperty`; after 2a, the yellow spray/transit lines and green S/F markers are confirmed `visible` (`map.getLayoutProperty`) alongside the moving drone on Simulate.
  * *Cons:* The 18s fixed preview duration is a UX choice, not a physically accurate one — it doesn't reflect the drone profile's actual `speedMps`, so a pilot can't use it to gauge real flight time (the Plan panel's "Flight time" stat is still the source of truth for that). The preview flies the *entire* plan (every sortie back-to-back) with no Plan Splitting awareness — a pilot previewing an active split still sees the full route, not just the included subset; not addressed here since it wasn't asked for, but a natural follow-up if Simulate is meant to rehearse exactly what a given sortie will upload. The RTL button's semantics here ("back to Start," distance 0) intentionally differ slightly from the real RTL button's ("back to the home/launch point," which can be a different coordinate from the route's Start — see ADR-018) — chosen because Simulate has no independent notion of a home point to preview flying to, only the route itself; worth reconciling if a future report treats that difference as another bug rather than the deliberate scope cut it is.

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
* **Status:** 27 test files, 225 tests passing (100% success rate).
* **Key Test Suites:**
  * `project.test.ts`: Validation of project record creation, recency sorting, and snapshot serialization.
  * `scenario.test.ts`: End-to-end integration test of an L-shaped field with pond exclusion, verifying sorties, passes, volumes, and readiness gating.
  * `delta.test.ts`: 17 tests validating point decimation, edge snapping, self-intersection rejection, plausibility thresholds, and provenance updates.
  * `circleObstacle.test.ts`: Circle-to-polygon conversion accuracy (radius, area) and its differencing against a boundary (fully-interior hole, edge-straddling clip) — see ADR-010.
  * `sessionScenario.test.ts`: `boundaryHasCorrections` (vertex and provenance divergence) and `runSessionBlindVsSighted`'s input selection — see ADR-011.
  * `planner.test.ts`: also covers `spacingOverrideM` (row count increases for a tighter override; a non-positive override is rejected rather than looping forever) and `translateSprayPlan` (every pass shifts by the offset, totals unchanged, zero-offset is a no-op) — see ADR-013.
  * `mavlinkSession.test.ts`: Mocked serial loopback testing the MAVLink mission upload handshake and readback verification, plus `armDisarm`/`setFlightMode` against a `FakeVehicle` extended to answer `COMMAND_LONG`/`SET_MODE` (accept, reject, and timeout cases) — see ADR-015.
  * `codec.test.ts` & `crc.test.ts`: Validation of MAVLink 2.0 frame packing, CRC-16-CCITT calculations, and `CRC_EXTRA` seeds across all 17 messages.
  * `geocoding.test.ts` & `tileUrl.test.ts`: Tests for Nominatim response parsing and resilient tile URL generation.
