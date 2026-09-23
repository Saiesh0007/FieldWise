# FieldWise — Engineering Rules & Operational Invariants

This document establishes the mandatory architectural rules, engineering standards, and invariants that must be upheld by all developers and AI agents contributing to FieldWise.

---

## Rule 1: Offline-First & Client-Side Invariant
* **Invariant:** Every computational feature (boundary parsing, projection, delta merging, path planning, file export, and MAVLink serialization) must execute 100% locally in the client browser.
* **Storage Standard:** All persistence (field boundaries, drone profiles, projects) must use browser-local storage (IndexedDB via `projectDb.ts` and the browser Cache API via `resilientSatelliteTiles.ts`). No user data, field coordinates, or telemetry may be transmitted to external servers.
* **Network Gracefulness:** Map tiles and geocoding services must gracefully handle offline conditions with fallback modes and clear UI indicators.

---

## Rule 2: Pure Domain Logic Separation
* **Invariant:** All code in `src/lib/` (specifically `src/lib/geo/`, `src/lib/export/`, `src/lib/simulation/`, and `src/lib/storage/project.ts`) must remain pure TypeScript functions.
* **Prohibited:**
  * No React hooks (`useState`, `useEffect`, `useMemo`) in `src/lib/`.
  * No direct DOM manipulation or window global dependencies (except browser driver glue strictly isolated inside `webSerialVehicle.ts`, `download.ts`, and `projectDb.ts`).
  * No Zustand store imports inside pure `src/lib/` domain modules. Domain logic receives input as arguments and returns immutable outputs.

---

## Rule 3: Atomic State Recomputation
* **Invariant:** Any state change that alters the boundary, edges, no-spray zones, drone profiles, or sweep strategies must funnel through the synchronous `recompute()` pipeline in `src/store/useFieldStore.ts`.
* **Rationale:** This guarantees that the boundary, local projection, spray plan, sorties, and readiness summary update together atomically in a single render tick. No intermediate or stale states are ever exposed to the UI.
* **Timing SLA:** The `lastRecomputeMs` benchmark must remain logged and visible; standard plans must compute in $< 1.5$ seconds (typically $10\text{--}45\text{ ms}$).

---

## Rule 4: Fail-Closed Readiness Gate
* **Invariant:** A flight plan cannot be uploaded to physical hardware via MAVLink if `readiness.cleared` is `false`.
* **Prohibited:** Adding bypass switches or "force upload" buttons that circumvent unverified edge checks. If an edge has not been physically walked, the operator must explicitly click "Accept Risk" to supply rationale, recording accountability into the provenance trail.

---

## Rule 5: Coordinate System & Metric Space Rigor
* **Invariant:** Never perform geometric distance, area, buffer, or angle calculations using raw WGS84 degree coordinates ($\Delta\text{lat}, \Delta\text{lon}$).
* **Requirement:**
  * Always project to local metric space (`[x, y]` in meters) via `createLocalProjection` (using local Azimuthal Equidistant `aeqd`) before performing geometry operations.
  * Inverse-project back to WGS84 `LatLng` only when preparing data for MapLibre GL rendering, GIS export, or MAVLink telemetry encoding.
  * Preserve untouched vertices bit-exact during delta splicing rather than subjecting them to lossy projection round-trips.

---

## Rule 6: Type Safety & Zero-`any` Standard
* **Invariant:** Strict TypeScript must be maintained across the entire codebase (`"strict": true` in `tsconfig.json`).
* **Requirements:**
  * Do not use `any`. Use strongly typed interfaces or generic parameters.
  * Exhaustive union checks should be used for discriminant types (e.g., `ProvenanceKind`, `WorkflowStep`, `SweepStrategy`).
  * Explicitly type all function signatures in public modules.

---

## Rule 7: Test Coverage & Regression Gate
* **Invariant:** Every new geometry algorithm, format exporter, or MAVLink codec message must be accompanied by Vitest unit tests.
* **Verification Mandate:**
  * Run `npm test` before committing any changes. All tests (currently 23 test files, 179+ tests) must pass with zero failures.
  * Any edge case found in polygon clipping, self-intersections, plausibility bounds, or MAVLink CRC calculation must be codified as a permanent regression test.

---

## Rule 8: Code Quality & Linting
* **Tools:** Oxlint (`npm run lint`) and TypeScript compiler (`npm run build`).
* **Requirement:** Code must build with zero compiler warnings and clean linting. Maintain clean imports, proper error handling, and consistent formatting.
