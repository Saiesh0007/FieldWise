# FieldWise — Development Rules

## 1. Core Rule

> **Do not build features that do not strengthen the field-correction and spray-planning workflow.**

The project must remain focused on CX0908.

---

## 2. Product Positioning

FieldWise is:

- A mobile field-planning application.
- A boundary-correction tool.
- A coverage-path planner.
- A hardware-agnostic mission preparation layer.

FieldWise is not:

- A full GCS replacement.
- A flight controller.
- A drone autopilot.
- A crop-disease detection platform.
- A pesticide recommendation system.

---

## 3. Hardware Independence

Core functionality must work without a drone connected.

The application must be usable for:

```text
Map
→ Correct
→ Plan
→ Validate
→ Export
```

Drone integration is optional.

---

## 4. Satellite Imagery Rule

Satellite imagery must always be treated as a potentially outdated reference.

Never describe the imported satellite boundary as ground truth.

The UI should expose imagery date where available.

---

## 5. GPS Accuracy Rule

Never claim that consumer phone GPS provides survey-grade boundary accuracy.

Always expose GPS accuracy when collecting a boundary.

Poor GPS accuracy must produce a warning.

---

## 6. Geometry Rule

All geographic calculations must use appropriate metric/projected coordinates where distance or area accuracy matters.

Do not calculate physical spray distances directly from raw latitude/longitude degrees.

---

## 7. Original vs Corrected Data

Never overwrite the original field boundary silently.

Maintain:

```text
Original Boundary
        +
Correction
        ↓
Corrected Boundary
```

This allows comparison and rollback.

---

## 8. No-Spray Rule

No-spray zones must always take priority over spray coverage.

Final spray area:

```text
Corrected Field − No-Spray Zones
```

The generated route must not intentionally pass through a validated no-spray zone.

---

## 9. Mission Validation Rule

A mission must not be marked ready merely because a route was generated.

Before export:

- Validate geometry.
- Validate boundary.
- Validate no-spray zones.
- Check path containment.
- Check mission parameters.
- Display warnings.

---

## 10. User Confirmation Rule

The pilot must explicitly confirm:

1. Corrected boundary.
2. Spray parameters.
3. Final mission.

Never silently export a modified mission.

---

## 11. Safety Rule

The application is a planning tool.

It must not imply that software validation alone guarantees safe flight.

Actual drone operations remain subject to:

- Local aviation regulations.
- Operator procedures.
- Manufacturer requirements.
- Site conditions.
- Weather.
- Aircraft limitations.
- Pilot judgment.

---

## 12. Offline Rule

Core field correction must not depend on continuous Internet connectivity.

The application should degrade gracefully when offline.

---

## 13. Data Rule

Use GeoJSON as the primary geometry interchange format.

Avoid proprietary geometry formats unless required for a specific integration.

---

## 14. Code Quality

Use:

- TypeScript for mobile application code.
- Modular components.
- Reusable geometry utilities.
- Clear function names.
- Strong typing.
- Meaningful error handling.
- Git version control.

Avoid:

- Giant components.
- Hard-coded coordinates.
- Hard-coded mission metrics.
- Duplicate geometry algorithms.
- Unnecessary dependencies.

---

## 15. Demo Rule

Every demo feature must correspond to a real implemented capability.

Do not simulate:

- GPS tracking.
- Path calculations.
- Coverage percentages.
- Flight distance.
- Mission generation.

If a value is estimated rather than measured, label it as an estimate.

---

## 16. AI Rule

AI is optional.

Do not add AI simply for presentation value.

The core problem can be solved using:

- GIS
- GPS
- Computational geometry
- Coverage-path planning
- Optimization

If AI is later introduced, it must solve a clearly defined problem.

---

## 17. MVP Priority

When time is limited, implement features in this order:

```text
1. Map
2. Field Boundary
3. Boundary Editing
4. GPS Correction
5. No-Spray Zones
6. Spray Path
7. Validation
8. Export
9. Offline
10. Drone Integration
```

Never sacrifice boundary correction to add flashy secondary features.

---

## 18. Definition of Done

A feature is considered complete only when:

- It works on a real device.
- It handles the normal case.
- It has basic error handling.
- It does not break existing field geometry.
- It can be demonstrated without manual code intervention.

---

## 19. Golden Rule

> **The pilot should be able to correct reality before the drone acts on the map.**