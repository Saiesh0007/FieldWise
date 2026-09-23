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
* **Status:** 23 test files, 179 tests passing (100% success rate).
* **Key Test Suites:**
  * `project.test.ts`: Validation of project record creation, recency sorting, and snapshot serialization.
  * `scenario.test.ts`: End-to-end integration test of an L-shaped field with pond exclusion, verifying sorties, passes, volumes, and readiness gating.
  * `delta.test.ts`: 17 tests validating point decimation, edge snapping, self-intersection rejection, plausibility thresholds, and provenance updates.
  * `mavlinkSession.test.ts`: Mocked serial loopback testing the MAVLink mission upload handshake and readback verification.
  * `codec.test.ts` & `crc.test.ts`: Validation of MAVLink 2.0 frame packing, CRC-16-CCITT calculations, and `CRC_EXTRA` seeds across all 14 messages.
  * `geocoding.test.ts` & `tileUrl.test.ts`: Tests for Nominatim response parsing and resilient tile URL generation.
