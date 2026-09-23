# FieldWise — Project Roadmap & Phase Tracking

This document tracks the phased development milestones of the FieldWise project, detailing completed deliverables, current active priorities, and future feature horizons.

---

## Roadmap Overview

```
Phase 1: Foundation & Geometry Core ────────────── [DONE]
Phase 2: Reactive State & Map Canvas ───────────── [DONE]
Phase 3: Verification & Delta Flow ─────────────── [DONE]
Phase 4: Readiness Gate & Exporters ────────────── [DONE]
Phase 5: Hardware Link & Simulator ─────────────── [DONE]
Phase 6: AeroGCS Green Parity & Resilient Map ──── [DONE]
Phase 7: In-Field Hardware Validation ──────────── [IN PROGRESS]
Phase 8: Advanced Autonomy & RTK ───────────────── [PLANNED]
```

---

## Phase Breakdown

### Phase 1: Foundation & Geometry Core (Completed)
* **Objective:** Build pure TypeScript geospatial math library capable of sub-second parallel swath planning and delta edge manipulation.
* **Key Deliverables:**
  * Dynamic local Azimuthal Equidistant (AEQD) metric projection (`src/lib/geo/projection.ts`) with sub-millimeter precision.
  * Delta edge correction engine (`src/lib/geo/delta.ts`) supporting tolerance-based simplification and endpoint snapping.
  * Boustrophedon sweep planner (`src/lib/geo/planner.ts`) with automatic angle optimization (`min-turns`), scanline even-odd slicing, and exclusion zone boolean subtraction.
  * Drone profile presets (`src/lib/geo/dronePresets.ts`) and sortie constraint modeling (`droneProfile.ts`).
  * Unit test suite covering projection math, polygon differences, and sweep trajectories.

### Phase 2: Reactive State & Map Canvas (Completed)
* **Objective:** Establish the visual foundation with MapLibre GL and a synchronous atomic state store.
* **Key Deliverables:**
  * Tailwind v4 CSS-first design system featuring high-contrast outdoor visual theme (`src/index.css`).
  * Atomic `recompute()` pipeline in `src/store/useFieldStore.ts` eliminating UI render tearing.
  * Interactive MapLibre GL vector canvas (`src/components/map/FieldMap.tsx`) with layer toggles for satellite tiles, boundary polygons, exclusion zones, and flight passes.
  * App shell and pilot 6-step workflow stepper (`src/components/layout/AppShell.tsx`, `Stepper.tsx`).

### Phase 3: Pilot Verification & GPS Correction Flow (Completed)
* **Objective:** Empower pilots to inspect individual boundary edges, capture live GPS walks, or accept risks.
* **Key Deliverables:**
  * Edge selection and provenance inspection list in `VerifyPanel.tsx`.
  * GPS walk capture component with browser Geolocation API integration (`GpsWalkCapture.tsx`).
  * Interactive mobile phone walk simulator (`PhoneFrameOverlay.tsx`) for realistic desktop end-to-end testing.
  * Douglas-Peucker point decimation tied to GPS accuracy radius: $\epsilon = \max(2.0\text{ m}, 1.5 \times \text{accuracyM})$.
  * Plausibility guard rejecting walked traces that stray farther than $0.2 \times \text{bounding\_box\_diagonal}$ (min 15 m) from the original edge.
  * Bit-exact vertex preservation for untouched boundary coordinates.
  * Single-click risk acceptance dialog with operator audit note capture.
  * Live recompute benchmark timer badge (`RecomputeTimingBadge.tsx`) verifying ~10–45 ms replanning speeds.

### Phase 4: Readiness Gate & Multi-Format Exporters (Completed)
* **Objective:** Guarantee flight safety via hard gating and provide seamless export across all major agricultural ground control stations.
* **Key Deliverables:**
  * Fail-closed readiness calculation engine (`src/lib/geo/readiness.ts`).
  * Real-time visual readiness status badge (`ReadinessBadge.tsx`).
  * QGroundControl `.plan` generator with coverage-geometry waypoints (`qgcPlan.ts`) — deliberately no sprayer actuator command; see Design.md §3.3.
  * ArduPilot Mission Planner `QGC WPL 110` `.waypoints` exporter (`missionPlannerWaypoints.ts`).
  * Standard GIS file exporters: GeoJSON (`geojson.ts`), KML with color-coded styles (`kml.ts`), and CSV tabular coordinates (`csv.ts`).
  * Standalone printable Pilot Handoff Briefing Sheet (`handoffSheet.ts`) with embedded verification sign-off certificate.

### Phase 5: Hardware Link & Dual Replay Simulator (Completed)
* **Objective:** Bridge directly to physical drone hardware and demonstrate the tangible safety advantage of delta corrections.
* **Key Deliverables:**
  * Custom TypeScript MAVLink 1.0 & 2.0 packet codec with CRC-16-CCITT and per-message `CRC_EXTRA` seeds across 14 supported messages (`src/lib/vehicle/mavlink/`).
  * W3C Web Serial API driver (`webSerialVehicle.ts`) for direct USB connection to Pixhawk autopilots without companion computers.
  * Mission protocol upload and byte-by-byte readback verification handshake (`mavlinkSession.ts`).
  * Dual-mode replay simulator ("The Drone That Flew Blind" vs "The Sighted Drone") visualizing collision/overspray prevention in real-time (`replay.ts`, `blindVsSightedScenario.ts`).

### Phase 6: AeroGCS Green Dashboard Parity & Resilient Map (Completed)
* **Objective:** Match leading agricultural GCS capabilities with local-first project management, map resilience, and comprehensive telemetry.
* **Key Deliverables:**
  * **Projects Management & Autosave:** IndexedDB storage (`fieldwise-projects`), recency sorting, project renaming/deletion, and debounced 600 ms autosave hook (`useProjectAutosave.ts`, `ProjectsPanel.tsx`).
  * **Settings Menu:** 3-dot menu with local storage purge modal and transparent offline-first cloud sync status (`SettingsMenu.tsx`).
  * **Live Telemetry Widgets:** Roll/pitch artificial horizon dial, heading compass, battery voltage & remaining %, altitude AGL, ArduPilot `WIND` telemetry, and "Center map on drone" button (`SendPanel.tsx`).
  * **Resilient Satellite Protocol (`fwsat://`):** Custom MapLibre protocol with browser Cache API session persistence, byte-size placeholder detection, and automatic OpenStreetMap raster tile fallback (`resilientSatelliteTiles.ts`).
  * **In-Place Basemap Toggle:** Fast switching between satellite imagery and street map without tearing down vector layers (`basemap.ts`).
  * **Global Place Search:** Debounced Nominatim geocoder supporting search by name and "Use my current location" GPS centering (`geocoding.ts`, `LocationSearch.tsx`).
  * **Four Plot-Creation Methods:** RC/Mobile (GPS walk), Drone (click-to-place at each corner, or an auto-play "Simulate demo"), Map (satellite trace), and Import KML/GeoJSON, behind a 2×2 method selector on the Import panel (`ImportPanel.tsx`, `DronePointCapture.tsx`) — completing AeroGCS Green's four documented plot-creation methods.
  * **Add Obstacle Tool (§12):** A standalone obstacle tool alongside plot creation, supporting **polygon** (freehand draw) and **circle** (center + radius, converted to a polygon via `circleObstacle.ts` and reusing the exact same no-spray-zone differencing) exclusion shapes (`ImportPanel.tsx`, `FieldMap.tsx`).
  * **Edit Obstacle (§12.3):** Drag a polygon obstacle's vertex to reposition it; select and delete a vertex (3-vertex minimum enforced); drag a circle obstacle's edge to resize it, keeping it a true circle. Live preview during drag, one store commit on release (`FieldMap.tsx`, `useFieldStore.ts`'s `updateNoSprayZone`).
  * **Session-Derived Blind vs. Sighted Replay:** The Simulate panel's replay now compares the pilot's own boundary as first imported (snapshotted once, before any correction) against their currently-corrected boundary — both scored against the current boundary as ground truth — instead of a fixed scripted scenario (`useFieldStore.ts`'s `originalBoundary`, `src/lib/simulation/sessionScenario.ts`). Reads "No corrections made yet" until a real correction has been made.
  * **Manual Plan Editing (§11, partial):** **Adjust Spacing** overrides the profile-derived row spacing (2–10m slider); **Route Adjust** gets an angle slider alongside the existing fixed-heading input, plus a Head Lock toggle (recorded, doesn't change geometry — FieldWise has no in-flight heading simulation to lock); **Move Plan** nudges the generated plan by an accumulated local-meter offset via directional buttons, independent of the boundary/zones (`PlanPanel.tsx`, `useFieldStore.ts`'s `spacingOverrideM`/`headLock`/`planOffsetLocal`, `planner.ts`'s `translateSprayPlan`).

> **Known incomplete work, not yet started:** a TCP↔WebSocket bridge to let FieldWise connect to Mission Planner's SITL simulator for hardware-free testing (browsers can't open raw TCP sockets, so this needs a small local relay process). The `ws`/`@types/ws` devDependencies were added in preparation for this, but no `TcpBridgeVehicle` class or bridge script exists yet — picking this up means starting from the dependency only, not from any working code.
>
> **Also not yet built (AeroGCS Green manual §10, §13, §14):**
> * **§10 Map Calibration** — nudging the map/GPS offset to correct a projection drift. A `calibrationOffset` field already exists on `FieldBoundary` but nothing reads or writes it yet.
> * **§13 Flyview** — a live in-flight HUD: arm/disarm bar, live spray-dosage calculation, range-finder obstacle detection, in-flight notifications feed. `SendPanel.tsx` has telemetry widgets (battery, altitude, heading, wind) but none of this.
> * **§14 Reports** — View Report / Generate Field Report (post-mission report history). No reports feature exists anywhere in the app.
>
> **§11 Manual Plan editing — partially built.** Route Adjust (angle slider + Head Lock), Adjust Spacing, and Move Plan are done (see below). Still missing: **Adjust Waypoint** (drag/nudge an individual generated waypoint — architecturally the hard one, since the plan is always regenerated fresh from the boundary/profile/strategy on every `recompute()`; a manually-dragged waypoint would need a real "manual override that survives the next re-plan" design, not just a one-off edit), **Indentation** (per-edge inward buffer from the boundary), **Obstacle Boundary spacing** (buffer distance around obstacles), and **Plan Splitting** (split a mission by % from the start/end for battery swaps, with Resume).

### Phase 7: In-Field Hardware Validation (Current Phase)
* **Objective:** Execute live bench and outdoor validation using physical Pixhawk hardware and USB cables.
* **Focus Areas:**
  * Follow protocol checklist in `VEHICLE_CONNECTION_CHECKLIST.md`.
  * Validate USB COM port detection across Windows, macOS, and Linux Chromium browsers.
  * Test outdoor 3D GPS lock transitions and HDOP scaling on u-blox M8N/M9N GPS units.
  * Confirm hand-held board tilt reflects instantaneously on the artificial horizon dial and heading compass.
  * Execute real mission uploads to Pixhawk 2.4.8 EEPROM and verify byte-for-byte readback.

### Phase 8: Advanced Autonomy & Next Horizons (Future)
* **Objective:** Scale capabilities for industrial multi-acre agricultural operations.
* **Planned Features:**
  * **RTK-GPS Integration:** Built-in NTRIP client connecting via WebSockets (`ws`) to local base stations for centimeter-level walk precision.
  * **Telemetry Relay:** Lightweight companion bridge relaying MAVLink over WiFi/4G for wireless tablet operation.
  * **3D Terrain Following:** Integration of open DEM elevation data (SRTM / Copernicus) to drape flight passes across hilly topography.
  * **Variable Rate Application (VRA):** Prescription NDVI map parsing to modulate drone flight speed or PWM pump output per zone.
