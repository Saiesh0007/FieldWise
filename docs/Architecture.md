# FieldWise — Architecture

## 1. System Overview

FieldWise is a mobile-first, hardware-agnostic field-mapping and spray-path planning application for agricultural drone operations.

The system addresses a specific operational problem:

> Satellite imagery may not represent the current field boundary. The pilot must be able to correct the boundary in the field before generating the spray mission.

The architecture therefore separates:

1. Field acquisition
2. Boundary correction
3. Field geometry processing
4. Spray-path generation
5. Mission validation
6. Mission export

The drone itself is **not required for the core application**.

---

## 2. High-Level Architecture

```text
┌───────────────────────────────────────────────┐
│              FIELDWISE MOBILE APP             │
│                                               │
│  ┌────────────┐  ┌─────────────┐             │
│  │ Field      │  │ Boundary    │             │
│  │ Selection  │→ │ Correction  │             │
│  └────────────┘  └──────┬──────┘             │
│                         │                     │
│              ┌──────────▼──────────┐          │
│              │ Corrected GeoJSON    │          │
│              │ Field Geometry       │          │
│              └──────────┬──────────┘          │
│                         │                     │
│              ┌──────────▼──────────┐          │
│              │ Spray Configuration │          │
│              └──────────┬──────────┘          │
│                         │                     │
│              ┌──────────▼──────────┐          │
│              │ Coverage Path       │          │
│              │ Planner             │          │
│              └──────────┬──────────┘          │
│                         │                     │
│              ┌──────────▼──────────┐          │
│              │ Mission Validation  │          │
│              └──────────┬──────────┘          │
│                         │                     │
│              ┌──────────▼──────────┐          │
│              │ Export / Sync       │          │
│              └─────────────────────┘          │
└───────────────────────────────────────────────┘
                       │
                       │ Optional
                       ▼
              ┌──────────────────┐
              │ Drone / Autopilot│
              │ Pixhawk / Other  │
              └──────────────────┘
```

---

## 3. Technology Stack

### Mobile Application

- React Native
- Expo
- TypeScript
- React Navigation
- Native GPS/location APIs

### Mapping

- MapLibre or Mapbox-compatible map rendering
- Satellite imagery provider
- GeoJSON
- Turf.js

### Backend

- Python
- FastAPI
- Shapely
- NumPy

The backend should handle computationally heavier geometry operations when required.

### Local Storage

- SQLite or equivalent local persistent storage
- Cached field geometry
- Cached map metadata
- Mission drafts
- User preferences

### Export

- GeoJSON
- KML
- CSV
- Optional autopilot mission format

---

## 4. Core Data Flow

```text
Satellite/GPS Boundary
        ↓
Initial Field Polygon
        ↓
Boundary Correction
        ↓
Corrected Polygon
        ↓
No-Spray Zones
        ↓
Spray Parameters
        ↓
Coverage Path Generation
        ↓
Path Validation
        ↓
Mission
        ↓
Export
```

---

## 5. Field Representation

All field boundaries should use a standard geospatial representation.

Primary format:

```json
{
  "type": "Feature",
  "properties": {
    "fieldId": "FIELD-001",
    "areaHa": 2.73
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": []
  }
}
```

GeoJSON is the preferred internal interchange format.

---

## 6. Boundary Correction

The application supports four correction mechanisms.

### 6.1 Vertex Editing

The pilot can drag existing polygon vertices.

### 6.2 Add Area

The pilot draws a polygon representing newly planted or previously unmapped crop area.

The system performs polygon union:

```text
Corrected Field =
Original Field ∪ Added Area
```

### 6.3 Remove Area

The pilot marks an area that should no longer be sprayed.

```text
Corrected Field =
Original Field − Removed Area
```

### 6.4 GPS Walk

The pilot walks/drives along a changed boundary.

GPS samples are collected and converted into a correction polygon.

The application must display GPS accuracy and must not claim survey-grade precision from consumer GPS.

---

## 7. No-Spray Zones

No-spray zones are represented as polygons.

Examples:

- Water bodies
- Buildings
- Roads
- Livestock areas
- Previously treated regions
- Other restricted areas

The final usable spraying area is:

```text
Spray Area =
Corrected Field − No-Spray Zones
```

---

## 8. Spray Path Planning

The initial planner will use a coverage-path approach based on parallel sweep lines.

Conceptually:

```text
→ → → → → → → →
                ↓
← ← ← ← ← ← ← ←
↓
→ → → → → → → →
                ↓
← ← ← ← ← ← ← ←
```

Effective path spacing:

```text
Effective Swath =
Spray Width × (1 − Overlap)
```

The planner must:

1. Generate candidate sweep lines.
2. Intersect them with the valid spray polygon.
3. Remove segments crossing no-spray zones.
4. Connect valid segments.
5. Calculate total distance.
6. Calculate turns.
7. Estimate mission duration.

---

## 9. Path Orientation

The system may evaluate multiple candidate orientations.

For each candidate:

```text
Cost =
w1 × FlightDistance
+
w2 × TurnCount
+
w3 × DeadheadDistance
```

The lowest-cost valid candidate is selected.

The weights should remain configurable during development.

---

## 10. Offline Architecture

The app must support essential field operations without continuous Internet access.

Offline-capable:

- Previously downloaded field
- Boundary editing
- GPS capture
- Field calculations
- Spray-path generation
- Mission storage
- Export

Internet-dependent operations may include:

- Downloading new satellite imagery
- Cloud synchronization
- Remote mission sharing

---

## 11. Hardware Abstraction

FieldWise must not depend on one drone manufacturer.

```text
FieldWise
    │
    ├── Generic Mission Export
    ├── Pixhawk / ArduPilot
    ├── Other Supported Autopilots
    └── Future Integrations
```

The Pixhawk 2.4.8 drone is a validation platform, not a system requirement.

---

## 12. Security and Safety

The application must:

- Validate polygons before planning.
- Prevent invalid/self-intersecting boundaries where possible.
- Warn when GPS accuracy is poor.
- Warn when no-spray zones intersect the intended path.
- Never silently overwrite an existing field.
- Preserve the original satellite boundary.
- Store a separate corrected version.
- Require pilot confirmation before mission export.

---

## 13. Architecture Principle

The system follows:

> **Map → Correct → Optimize → Validate → Export**

The application is a planning and decision-support layer, not a replacement for the drone's flight controller.