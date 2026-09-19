# FieldWise — Product & UX Design

## 1. Design Goal

FieldWise should feel like a professional field tool rather than a generic map application.

The pilot should be able to:

1. Open a field.
2. Verify the satellite boundary.
3. Correct discrepancies.
4. Configure spraying.
5. Generate a route.
6. Review safety warnings.
7. Export the mission.

The complete workflow should require minimal interaction.

---

## 2. Primary User

### Agricultural Drone Pilot

The pilot may operate different drone hardware and may not have technical GIS knowledge.

The interface must therefore prioritize:

- Map visibility
- Large touch targets
- Clear terminology
- Minimal configuration
- Immediate visual feedback

---

## 3. Main Navigation

Recommended navigation:

```text
Home
  │
  ├── Fields
  │     ├── Field Details
  │     └── Edit Boundary
  │
  ├── Missions
  │
  └── Settings
```

Avoid excessive navigation depth.

---

## 4. Screen Architecture

### Screen 1 — Home

Displays:

- Recent fields
- Recent missions
- New Field
- Import Field

Primary CTA:

**+ New Field**

---

### Screen 2 — Field Selection

Options:

```text
Current Location
Import GeoJSON/KML
Select Existing Field
Search Location
```

Once selected:

```text
Field Name
Area
Satellite imagery date
Boundary status
```

---

### Screen 3 — Field Correction

This is the primary differentiating screen.

Tools:

```text
ADD
REMOVE
MOVE
GPS WALK
NO-SPRAY
UNDO
REDO
```

The original boundary must remain visually distinguishable from the corrected boundary.

Example:

```text
Original Boundary
- - - - - - - - -

Corrected Boundary
───────────────
```

---

## 5. GPS Walk UX

The pilot taps:

**GPS WALK**

The application displays:

```text
GPS Accuracy: ±4.8 m

Walk along the boundary.

[ START ]

Recorded Points: 0
```

During capture:

```text
● GPS tracking active

Points: 37
Accuracy: ±5.1 m
Distance: 126 m

[ PAUSE ] [ FINISH ]
```

After finishing:

```text
Review Captured Boundary

[ DISCARD ]
[ ACCEPT ]
```

The system must not automatically commit GPS corrections without confirmation.

---

## 6. Spray Configuration

Use simple controls.

```text
Spray Width       4.5 m
Overlap           15%
Flight Speed      4.0 m/s
Altitude          3.0 m
```

Advanced settings should be hidden by default.

---

## 7. Path Planning Screen

Display:

- Field
- No-spray zones
- Planned path
- Start point
- End point
- Direction arrows

Metrics:

```text
Area
Coverage
Distance
Turns
Estimated Time
```

---

## 8. Before/After Visualization

The user should be able to toggle:

```text
ORIGINAL
CORRECTED
SPRAY PATH
NO-SPRAY
```

A split-screen comparison may be used where appropriate.

---

## 9. Validation Screen

Before mission export:

```text
MISSION CHECK

✓ Boundary valid
✓ No-spray zones valid
✓ Path inside field
✓ Coverage calculated
✓ GPS correction confirmed

Warnings:
⚠ GPS correction accuracy: ±6.2 m

[ REVIEW ]
[ EXPORT MISSION ]
```

The user must explicitly confirm the final mission.

---

## 10. Visual Design

The visual language should communicate:

- Agriculture
- Precision
- Technology
- Reliability

Avoid making the interface look like a gaming drone controller.

Recommended visual hierarchy:

```text
Map = dominant

Controls = bottom sheet

Metrics = compact cards

Warnings = highly visible

Primary CTA = clear and consistent
```

---

## 11. Mobile Interaction Principles

- Minimum comfortable touch targets.
- Avoid tiny map controls.
- Avoid long forms.
- Prefer sliders/selectors where appropriate.
- Keep the map visible during important operations.
- Use confirmation dialogs for destructive actions.
- Support landscape mode for tablet use.

---

## 12. Error States

### Poor GPS

```text
GPS accuracy is currently ±18 m.

Move to an open area before capturing
the boundary.
```

### Invalid Polygon

```text
Boundary cannot be planned.

The polygon overlaps itself.
Please correct the highlighted area.
```

### No-Spray Conflict

```text
No-spray zone intersects the planned route.

The route will be recalculated.
```

### Offline

```text
You're offline.

Cached field data is available.
Satellite updates are unavailable.
```

---

## 13. Design Principle

Every important action should answer:

> **What is the pilot trying to do right now?**

The application should never expose unnecessary GIS or drone-engineering complexity during normal operation.