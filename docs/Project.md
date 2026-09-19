# FieldWise

## CX0908 — The Drone That Flew Blind

### Mobile Field-Mapping & Adaptive Spray-Path Planning

---

## 1. Overview

FieldWise is a mobile-first software platform for agricultural drone-spraying operations.

It allows pilots to use satellite/GPS information as an initial field boundary, correct that boundary directly in the field, and generate an updated spray path before flight.

The system is designed to be hardware agnostic.

---

## 2. Problem

Agricultural drone spraying often depends on manually planned field boundaries and spray paths.

Satellite imagery can become outdated.

A field may change because of:

- Newly planted areas
- Removed crops
- Changed crop lines
- Roads
- Water accumulation
- Temporary restrictions
- Previously treated regions

If the planning system blindly trusts an outdated boundary, the drone may:

- Miss crop areas.
- Spray outside the intended field.
- Waste chemical.
- Increase flight distance.
- Require manual pilot corrections.

---

## 3. Solution

FieldWise creates a correction loop:

```text
Satellite
    ↓
Initial Boundary
    ↓
Pilot Verification
    ↓
Field Correction
    ↓
Updated Boundary
    ↓
Optimal Spray Path
```

The pilot remains in control of the final field definition.

---

## 4. Core Features

### Field Mapping

- Satellite map
- GPS location
- Field polygon
- GeoJSON/KML import

### Boundary Correction

- Add area
- Remove area
- Move vertices
- GPS Walk
- Undo/redo

### Spray Planning

- Spray width
- Overlap
- Flight speed
- Altitude
- Coverage path generation

### Safety

- No-spray zones
- Boundary validation
- Path validation
- GPS accuracy warnings

### Output

- GeoJSON
- KML
- CSV
- Optional drone mission format

---

## 5. Key Innovation

### Adaptive Field Boundary

The application treats satellite imagery as a reference rather than absolute truth.

The pilot can update the actual field boundary immediately before planning the mission.

Every accepted boundary correction causes the spray path to be recalculated.

---

## 6. Hardware Agnostic Design

FieldWise does not require a specific agricultural drone.

Possible workflow:

```text
FieldWise
    ↓
Generic Mission
    ↓
Compatible GCS / Autopilot
    ↓
Agricultural Drone
```

A Pixhawk-based drone can be used for prototype validation.

---

## 7. Target Workflow

### Before arriving

Pilot downloads the field.

### At field

Pilot opens the cached field.

### Verification

Pilot compares the satellite boundary with the actual field.

### Correction

Pilot edits the boundary or walks the changed section.

### Planning

Pilot enters spray parameters.

### Optimization

FieldWise generates the coverage path.

### Validation

Pilot reviews warnings and mission metrics.

### Export

Mission is exported to the required drone/GCS system.

---

## 8. Example Mission Metrics

The application should calculate actual values for:

- Field area
- Sprayable area
- Coverage percentage
- Total route distance
- Number of turns
- Estimated flight time
- Estimated spray requirement

No fixed demonstration numbers should be hard-coded into the final product.

---

## 9. Technical Stack

```text
Mobile:
React Native + Expo + TypeScript

Mapping:
MapLibre / Mapbox
GeoJSON
Turf.js

Backend:
FastAPI
Python
Shapely
NumPy

Storage:
SQLite / local persistence

Export:
GeoJSON
KML
CSV
Mission format
```

---

## 10. Project Structure

```text
fieldwise/
│
├── mobile/
│   ├── app/
│   ├── components/
│   ├── screens/
│   ├── hooks/
│   ├── services/
│   ├── storage/
│   ├── geo/
│   └── types/
│
├── backend/
│   ├── api/
│   ├── geometry/
│   ├── planner/
│   ├── validation/
│   └── export/
│
├── docs/
│   ├── Architecture.md
│   ├── Design.md
│   ├── Memory.md
│   ├── Phases.md
│   ├── Project.md
│   └── Rules.md
│
└── README.md
```

---

## 11. Success Criteria

The prototype is successful when a pilot can:

1. Open an existing field.
2. See its mapped boundary.
3. Identify a boundary discrepancy.
4. Correct the discrepancy.
5. Generate a spray route.
6. Avoid no-spray areas.
7. Validate the route.
8. Export the mission.

The complete flow should be demonstrable on a mobile device.