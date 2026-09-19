# FieldWise — Project Memory

## 1. Project Identity

### Project Name

**FieldWise**

### Problem Code

**CX0908**

### Problem

An agricultural drone-spraying service relies on manual pilot guesswork for field boundaries and spray paths.

A field boundary obtained from an outdated satellite image may no longer represent the actual crop boundary.

The system must allow the pilot to correct the boundary in the field before flight.

---

## 2. Core Product

FieldWise is a mobile-first, software-only field mapping and spray-path planning application.

It is designed to work independently of a specific drone manufacturer.

Core principle:

> **Satellite imagery provides the starting boundary, not the final truth.**

---

## 3. Central Workflow

```text
Satellite/GPS
     ↓
Initial Boundary
     ↓
Field Correction
     ↓
Corrected Boundary
     ↓
Spray Configuration
     ↓
Optimal Coverage Path
     ↓
Validation
     ↓
Mission Export
```

---

## 4. Differentiation

FieldWise should not attempt to become a complete agricultural Ground Control Station.

The primary differentiation is:

### Field-side boundary correction

The pilot can:

- Add missing crop area.
- Remove outdated crop area.
- Move boundary vertices.
- Walk along a changed boundary using GPS.
- Mark no-spray zones.

The spray path is regenerated automatically after correction.

---

## 5. AeroGCS Context

PDRL's AeroGCS ecosystem already covers agricultural drone mission planning and field-related operations.

Therefore FieldWise should not be positioned as:

> "A better AeroGCS."

Instead:

> **"A hardware-agnostic field correction and spray-planning layer focused on the gap between satellite mapping and real-world field conditions."**

The project should avoid copying existing GCS functionality unnecessarily.

---

## 6. Existing Hardware for Validation

Available validation platform may include:

- F450 frame
- Pixhawk 2.4.8
- GPS
- Raspberry Pi 3/4
- Raspberry Pi Camera
- Motors
- ESCs
- Propellers

This hardware is optional for the software MVP.

The drone is used primarily for demonstration and mission validation.

---

## 7. Target Users

Primary:

- Agricultural drone pilots
- Agricultural drone service operators

Secondary:

- Farm operators
- Agricultural service providers

---

## 8. MVP

The minimum viable product must support:

1. Field selection.
2. Satellite/map boundary.
3. Boundary editing.
4. GPS-assisted correction.
5. No-spray zones.
6. Spray parameters.
7. Coverage-path generation.
8. Path visualization.
9. Mission validation.
10. GeoJSON/KML/mission export.

---

## 9. Explicit Non-Goals

The MVP does not need:

- Crop disease detection.
- AI pesticide recommendations.
- Autonomous obstacle avoidance.
- Flight-controller development.
- Battery management.
- Full telemetry.
- Drone fleet management.
- Complete GCS replacement.

---

## 10. Demo Story

The demo should intentionally demonstrate the failure of relying blindly on satellite imagery.

Scenario:

1. Load an outdated field boundary.
2. Generate a spray path.
3. Reveal a newly planted strip.
4. Correct the boundary using the mobile app.
5. Recalculate the field area.
6. Regenerate the spray path.
7. Show before/after metrics.
8. Export the mission.
9. Optionally validate it on the Pixhawk platform.

---

## 11. Key Message

> **The pilot does not blindly trust the satellite boundary. FieldWise lets the pilot correct reality before the drone acts on the map.**