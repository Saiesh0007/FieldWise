# FieldWise — Technical Design Document

This document outlines the detailed domain models, core mathematical algorithms, protocol implementations, and user experience design patterns implemented in FieldWise.

---

## 1. Domain Models & Data Structures

All core data structures reside in `src/lib/geo/types.ts` and `src/lib/storage/project.ts`.

### 1.1. Coordinates & Metric Points
```typescript
/** WGS84 Geodetic coordinate (degrees, GeoJSON lon/lat order). */
export interface LatLng {
  lon: number
  lat: number
}

/** 2D Euclidean coordinate in meters relative to local projection origin. */
export interface LocalPoint {
  x: number
  y: number
}
```

### 1.2. Boundary & Edge Provenance
```typescript
export type ProvenanceKind = 'satellite' | 'walked' | 'confirmed'

export interface EdgeProvenance {
  kind: ProvenanceKind
  /** ISO date of source satellite imagery when kind === 'satellite'. */
  imageryDate?: string
  /** Estimated GPS accuracy radius in meters when kind === 'walked'. */
  accuracyM?: number
  /** ISO timestamp of when the edge was last verified or updated. */
  verifiedAt?: string
  /** Pilot explicitly accepted risk instead of verifying (readiness gate override). */
  acceptedRisk?: boolean
}

/** One edge of the boundary polygon, connecting vertex[fromIndex] to vertex[toIndex]. */
export interface BoundaryEdge {
  id: string
  fromIndex: number
  toIndex: number
  provenance: EdgeProvenance
}

export type BoundarySource = 'satellite-trace' | 'gps-walk' | 'drone-walk' | 'kml-import' | 'geojson-import'

export interface FieldBoundary {
  id: string
  vertices: LatLng[]
  edges: BoundaryEdge[]
  source: BoundarySource
  createdAt: string
  /** Optional one-tap imagery/GPS offset correction applied to every vertex. */
  calibrationOffset?: { dLon: number; dLat: number }
}
```
`boundary.ts`'s `defaultProvenanceFor()` treats `gps-walk` and `drone-walk` identically — both are ground-truth acts (points captured at a known real-world location), so their edges start `'walked'`, not `'satellite'`. `satellite-trace`, `kml-import`, and `geojson-import` all start `'satellite'` regardless of which tool produced the file, since none of them represent a physically-verified position.

### 1.3. Drone Profiles & No-Spray Zones
```typescript
export interface DroneProfile {
  id: string
  name: string
  swathM: number                 // Effective spray swath width in meters (e.g., 4.0m)
  speedMps: number               // Operational flight ground speed in m/s (e.g., 4.5 m/s)
  tankL: number                  // Total liquid capacity in liters (e.g., 10.0L)
  applicationRateLPerHa: number  // Target spray volume per hectare (e.g., 15.0 L/ha)
  altitudeM: number              // Cruise altitude AGL in meters (e.g., 2.5m)
  enduranceMin: number           // Usable flight time per battery/tank cycle (e.g., 12 min)
  turnPenaltySec: number         // Turnaround maneuver buffer time per pass end (e.g., 4.0s)
}

export interface NoSprayZone {
  id: string
  label: string
  vertices: LatLng[]
}
```

### 1.4. Flight Plan, Sorties & Passes
```typescript
export type SweepStrategy =
  | { kind: 'min-turns' }
  | { kind: 'fixed-heading'; headingDeg: number }
  | { kind: 'crop-row'; headingDeg: number }

export interface SprayPass {
  start: LocalPoint
  end: LocalPoint
  spraying: boolean  // true during spray traversal; false during turnaround/transit
}

export interface Sortie {
  index: number
  passes: SprayPass[]
  distanceM: number
  volumeL: number
  estimatedMinutes: number
}

export interface SprayPlan {
  sorties: Sortie[]
  totalDistanceM: number
  totalVolumeL: number
  totalEstimatedMinutes: number
  areaHa: number
  headingDeg: number
}
```

### 1.5. Safety Readiness Gate
```typescript
export interface ReadinessSummary {
  cleared: boolean
  totalEdges: number
  unverifiedEdges: number
  unverifiedLengthM: number
  acceptedRiskEdges: number
  blockingEdgeIds: string[]
}
```

### 1.6. Project Storage Records
```typescript
export interface ProjectSnapshot {
  boundary: FieldBoundary | null
  noSprayZones: NoSprayZone[]
  droneProfile: DroneProfile
  sweepStrategy: SweepStrategy
}

export interface ProjectRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: ProjectSnapshot
}
```

---

## 2. Core Algorithms & Mathematical Foundations

### 2.1. Local Metric Projection (`projection.ts`)
Standard Web Mercator projection causes significant area and distance distortion that varies with latitude. Global spherical geodesic calculations (Vincenty/Haversine) are too slow for hundreds of continuous polygon slicing operations.

**Solution:** FieldWise dynamically creates a local Azimuthal Equidistant (AEQD) metric projection centered on the arithmetic mean centroid of the imported field using `proj4`:
$$\text{PROJ.4 definition} = \text{`+proj=aeqd +lat_0=}\phi_0\text{ +lon_0=}\lambda_0\text{ +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'}$$
where $\phi_0$ is `origin.lat` and $\lambda_0$ is `origin.lon`.
* **Properties:** Preserves true distances from the origin point. Distortion of angles and areas across operational field scales (hundreds of meters to kilometers) remains well under $0.1\%$.
* **Forward:** $(\lambda, \phi) \rightarrow (x, y)$ in meters for all planar geometry algorithms.
* **Inverse:** $(x, y) \rightarrow (\lambda, \phi)$ in WGS84 for MapLibre rendering and autopilot exports.

### 2.2. Delta Edge Correction & Merging (`delta.ts`)
When a pilot walks an edge with GPS or inputs a replacement curve:
1. **Target Identification:** Finds the boundary edge matching `edgeId`.
2. **Douglas-Peucker Simplification:** Real GPS walk traces contain dozens of noisy, closely spaced points. The curve is simplified in local metric space with tolerance tied to GPS accuracy:
   $$\epsilon = \max(2.0\text{ m}, 1.5 \times \text{accuracyM})$$
   This absorbs uncorrelated point jitter without flattening genuine physical curves or exploding the boundary vertex count.
3. **Plausibility Guard:** Evaluates perpendicular distance from each simplified point to the original edge segment:
   $$\text{maxDeviation} = \max(15\text{ m}, 0.2 \times \text{diagonal}(\text{boundaryBoundingBox}))$$
   If any point exceeds this distance, `DeltaError` is thrown, catching errant walks that loop into the field interior.
4. **Topological Validation:** The spliced polygon ring is tested for self-intersections using Turf `kinks`.
5. **Bit-Exact Vertex Splicing:** Rather than inverse-projecting all boundary vertices through the AEQD projection (which is not bit-for-bit invertible), the untouched vertices are preserved directly from the original `boundary.vertices` array. Only the newly inserted vertices are added.
6. **Provenance Assignment:** The newly created sub-edges receive `provenance: { kind: 'walked', accuracyM, verifiedAt }`. Untouched edges maintain their existing provenance and are re-indexed.

### 2.3. Boustrophedon Swath & Path Planning (`planner.ts`)
The planning algorithm executes in local metric space:

```
[Local Metric Polygon]
        │
        ▼ Subtract No-Spray Exclusion Zones (polygon-clipping)
[Sprayable Multi-Polygon]
        │
        ▼ Rotate by -θ (headingRad)
[Rotated Sweep Space]
        │
        ▼ Slice into horizontal scanlines spaced by swathM * (1 - overlapFraction)
[Scanline Spans (even-odd crossing)]
        │
        ▼ Alternate segment directions per row & connect with transit legs (spraying: false)
[Continuous Boustrophedon Trajectory]
        │
        ▼ Rotate by +θ back to local space
[Field-Local SprayPass List]
        │
        ▼ Partition by tank capacity (tankL) and battery limit (enduranceMin)
[Sorties & Totals (SprayPlan)]
```

1. **Heading Determination:**
   - `min-turns`: Minimizes turn count using rotating calipers to find the polygon's minimum Feret diameter.
   - `fixed-heading`: Pilot-specified compass heading.
   - `crop-row`: Heading derived from two tapped points along a visible crop row via `atan2`.
2. **Scanline Even-Odd Slicing:** Evaluates intersections between horizontal row lines and polygon boundary edges, handling concave fields and internal holes automatically.
3. **Sortie Partitioning (`droneProfile.ts`):** Accumulates chemical volume consumed ($A_{\text{ha}} \times \text{Rate}_{\text{L/ha}}$) and flight time ($\frac{\text{Distance}}{\text{Speed}} + \text{Turns} \times \text{TurnPenalty}$). A new sortie break is inserted whenever the accumulated load approaches `tankL` or time approaches `enduranceMin`.

### 2.4. Hard Readiness Safety Gate (`readiness.ts`)
The readiness engine enforces the mission clearance rule:
$$\text{cleared} \iff \forall e \in \text{Edges}, \left(e.\text{provenance}.\text{kind} \ne \text{'satellite'} \lor e.\text{provenance}.\text{acceptedRisk} = \text{true}\right)$$
If unverified edges exist, `cleared` is `false` and `blockingEdgeIds` lists all non-cleared edge IDs. This hard gate blocks:
* Pixhawk mission upload via Web Serial in `SendPanel.tsx`.
* Final clearance badge on the header and handoff briefing sheet.

---

## 3. Web Serial & MAVLink Hardware Protocol

### 3.1. Physical & Transport Layer
* Interface: W3C Web Serial API (`navigator.serial`).
* Baud Rate: 115,200 baud, 8 data bits, 1 stop bit, no parity, no flow control.

### 3.2. MAVLink 2.0 Packet Framing
```
[0xFD] [LEN] [INCOMPAT] [COMPAT] [SEQ] [SYSID] [COMPID] [MSGID (3 bytes)] [PAYLOAD (0-255)] [CHECKSUM (2 bytes)]
```
* **STX:** `0xFD` for MAVLink 2.0 (`0xFE` for legacy MAVLink 1.0).
* **Checksum:** CRC-16-CCITT with seed initialized to `0xFFFF`, updated across the header, message ID, and payload, terminated by the message-specific `CRC_EXTRA` seed byte.
* **Payload Truncation:** Conforms to MAVLink 2.0 zero-truncation rules on transmit and zero-padding on receive.

### 3.3. Supported MAVLink Messages
| ID | Message Name | Payload (Bytes) | CRC_EXTRA | Direction | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | `HEARTBEAT` | 9 | 50 | Bidirectional | GCS heartbeat sent at 1 Hz; decodes autopilot type and custom flight mode |
| 1 | `SYS_STATUS` | 43 | 124 | Receive | Decodes battery voltage (`voltageBattery / 1000.0`) and remaining % (`batteryRemaining`) |
| 24 | `GPS_RAW_INT` | 52 | 24 | Receive | Decodes fix type (`fixType`), satellite count, and HDOP (`eph / 100.0`) |
| 30 | `ATTITUDE` | 28 | 39 | Receive | Decodes vehicle roll, pitch, and yaw in radians (converted to degrees) |
| 33 | `GLOBAL_POSITION_INT` | 28 | 104 | Receive | Decodes vehicle latitude ($10^7$), longitude ($10^7$), and relative altitude AGL |
| 40 | `MISSION_REQUEST` | 5 | 230 | Receive | Legacy waypoint request from older autopilot firmware |
| 43 | `MISSION_REQUEST_LIST` | 3 | 132 | Send | Initiates mission download handshake for readback verification |
| 44 | `MISSION_COUNT` | 9 | 221 | Bidirectional | Declares total number of waypoints in upload/download transaction |
| 46 | `MISSION_ITEM_REACHED` | 2 | 11 | Receive | Autopilot progress notification during autonomous execution |
| 47 | `MISSION_ACK` | 8 | 153 | Bidirectional | Final acknowledgment confirming mission transaction result (`0 = ACCEPTED`) |
| 51 | `MISSION_REQUEST_INT` | 5 | 196 | Receive | Requests specific waypoint sequence $i$ using integer micro-degrees |
| 73 | `MISSION_ITEM_INT` | 38 | 38 | Bidirectional | Waypoint coordinates ($10^7$), altitude — every leg is a plain `MAV_CMD_NAV_WAYPOINT` (16); **no `DO_SET_SERVO`/actuator command is sent** — uploads are coverage geometry only, not sprayer on/off control (a deliberate, documented scope cut, not an oversight — see `missionFromPlan.ts`'s header comment) |
| 74 | `VFR_HUD` | 20 | 20 | Receive | Decodes airspeed, groundspeed, barometric altitude, and compass heading |
| 168 | `WIND` | 12 | 1 | Receive | Decodes ArduPilot-estimated wind direction and horizontal speed |

### 3.4. ArduCopter Mode Decoding
When `HEARTBEAT.baseMode` includes `MAV_MODE_FLAG_CUSTOM_MODE_ENABLED` (bit 0), `customMode` maps to standard ArduCopter modes:
* `0`: Stabilize, `2`: Alt Hold, `3`: Auto, `4`: Guided, `5`: Loiter, `6`: RTL, `9`: Land, `11`: Drift, `13`: Sport, `16`: PosHold, `17`: Brake, `20`: Guided (no GPS), `21`: Smart RTL.

---

## 4. UI/UX Component Architecture

* **`AppShell.tsx` & `Stepper.tsx`:** Provides workflow navigation across the 6 steps, gates future steps behind prerequisite data, and displays active project name, recompute timing badge, readiness badge, and settings menu.
* **`SettingsMenu.tsx`:** 3-dot dropdown providing drone connection shortcuts, local IndexedDB storage wipe with confirmation, and offline-first cloud sync status.
* **`ProjectsPanel.tsx`:** Slide-out modal listing saved projects sorted by recency, allowing creating, loading, renaming, and deleting projects.
* **`LocationSearch.tsx`:** Geocoding input integrated into Import panel with debounced Nominatim search, current geolocation acquisition, and camera bounding-box fly-to.
* **`FieldMap.tsx`:** MapLibre GL vector canvas managing dynamic layers:
  - Resilient satellite tile source (`fwsat://`) with automatic fallback to OSM raster tiles.
  - Basemap toggle button switching between satellite and street map in place.
  - Field boundary with provenance-colored edges (Amber, Green, Blue).
  - Exclusion zones with crosshatch fills.
  - Directional swath lines with sortie color coding.
  - Drone point-capture crosshair mode with a top banner, for the "Drone" plot-creation method — each click emits one boundary point at the clicked coordinate.
  - `flyTo` camera control shared by both "Search a location" and Send to Vehicle's "Center map on drone" button — recenters the map on a coordinate; not a persistent live marker.
* **`PhoneFrameOverlay.tsx`:** Interactive desktop testing frame providing simulated GPS walk breadcrumb capture with realistic randomized noise circles.
* **`SendPanel.tsx`:** Live hardware connection hub featuring Web Serial port selector, connection state machine, artificial horizon attitude dial, heading compass, and live battery, altitude, wind, and GPS stat cards.
