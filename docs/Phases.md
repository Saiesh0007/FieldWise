# FieldWise — Development Phases

## Phase 0 — Project Setup

### Goal

Create the project foundation.

### Tasks

- Create React Native + Expo project.
- Configure TypeScript.
- Configure navigation.
- Establish Git repository.
- Create project folder structure.
- Add basic design system.
- Define GeoJSON types.

### Deliverable

App launches successfully with Home screen.

---

# Phase 1 — Map & Field

### Goal

Display and store agricultural fields.

### Tasks

- Integrate map provider.
- Display current location.
- Display satellite/map layer.
- Create sample field polygons.
- Calculate field area.
- Store field metadata.
- Implement field selection.

### Deliverable

User can open a field and see its boundary on the map.

---

# Phase 2 — Boundary Editing

### Goal

Implement the core problem-solving feature.

### Tasks

- Move boundary vertices.
- Add polygon.
- Remove polygon.
- Union added areas.
- Subtract removed areas.
- Undo/redo.
- Validate geometry.
- Preserve original boundary.

### Deliverable

User can modify an outdated satellite boundary.

---

# Phase 3 — GPS Boundary Correction

### Goal

Allow field-side correction.

### Tasks

- Request location permission.
- Display GPS accuracy.
- Capture GPS points.
- Display recorded track.
- Pause/resume capture.
- Finish capture.
- Convert track to boundary/correction.
- Review before acceptance.

### Deliverable

Pilot can walk along a changed field boundary and import the correction.

---

# Phase 4 — No-Spray Zones

### Goal

Protect restricted areas.

### Tasks

- Draw no-spray polygons.
- Edit no-spray polygons.
- Validate intersections.
- Subtract no-spray regions from usable field.

### Deliverable

Planner produces a sprayable region excluding restricted areas.

---

# Phase 5 — Spray Path Planner

### Goal

Generate an efficient coverage route.

### Tasks

- Add spray parameters.
- Calculate effective swath.
- Generate candidate orientations.
- Generate sweep lines.
- Clip sweep lines to field.
- Remove no-spray sections.
- Connect path segments.
- Calculate distance.
- Calculate turns.
- Estimate mission duration.

### Deliverable

Corrected field produces a valid coverage path.

---

# Phase 6 — Validation

### Goal

Ensure the generated mission is geometrically valid.

### Tasks

- Boundary validation.
- Path containment check.
- No-spray intersection check.
- Start/end validation.
- Coverage calculation.
- GPS correction warning.
- Mission summary.

### Deliverable

Pilot receives a clear pre-flight validation result.

---

# Phase 7 — Export

### Goal

Make the output hardware-agnostic.

### Tasks

- GeoJSON export.
- KML export.
- CSV waypoint export.
- Define generic mission schema.
- Investigate Pixhawk/ArduPilot-compatible export.

### Deliverable

Generated mission can be transferred to another system.

---

# Phase 8 — Offline Support

### Goal

Support field operations with poor connectivity.

### Tasks

- Cache fields.
- Cache required map information.
- Local mission storage.
- Offline editing.
- Offline GPS capture.
- Offline path planning.
- Sync after reconnecting.

### Deliverable

Core workflow works without continuous Internet.

---

# Phase 9 — Drone Validation

### Goal

Validate generated missions using available hardware.

### Tasks

- Prepare Pixhawk test platform.
- Verify coordinate system.
- Import/export test mission.
- Validate waypoint sequence.
- Conduct simulation first.
- Perform controlled field test only after safety checks.

### Deliverable

Software-generated mission demonstrated on a compatible drone platform.

---

# Phase 10 — Final Demo & Presentation

### Goal

Demonstrate the CX0908 problem and solution clearly.

### Demo sequence

1. Open outdated satellite boundary.
2. Generate original route.
3. Identify field change.
4. Correct boundary.
5. Show GPS-assisted correction.
6. Recalculate area.
7. Regenerate path.
8. Compare before/after.
9. Validate.
10. Export mission.
11. Optional drone validation.

### Final message

> **The pilot does not blindly trust the satellite boundary. FieldWise lets the pilot correct reality before the drone acts on the map.**