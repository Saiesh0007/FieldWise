import { describe, expect, it } from 'vitest'
import { planFinishPoint, planStartPoint, planSprayPath, splitPlanPasses, translateSprayPlan } from './planner'
import type { DroneProfile, LocalPoint, SprayPass } from './types'

const profile = (overrides: Partial<DroneProfile> = {}): DroneProfile => ({
  id: 'test',
  name: 'Test rig',
  swathM: 10,
  speedMps: 5,
  tankL: 100, // generous by default — tests that care about tank limits override this
  applicationRateLPerHa: 1,
  altitudeM: 3,
  enduranceMin: 20,
  turnPenaltySec: 5,
  ...overrides,
})

function sprayingPasses(plan: ReturnType<typeof planSprayPath>): SprayPass[] {
  return plan.sorties.flatMap((s) => s.passes).filter((p) => p.spraying)
}

function passLengthM(p: SprayPass): number {
  return Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y)
}

describe('planSprayPath — concave field', () => {
  // An "L" shape: a 100x100 square with the top-right 60x60 corner
  // removed (i.e. field boundary dips inward at (40,40)). Total sprayable
  // area = 100*100 - 60*60 = 6400 m² = 0.64 ha.
  const lShape: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ]

  it('narrows the sweep rows inside the notch instead of spraying outside the boundary', () => {
    const plan = planSprayPath({
      boundaryLocal: lShape,
      noSprayZonesLocal: [],
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    expect(plan.areaHa).toBeCloseTo(0.64, 6)

    const passes = sprayingPasses(plan)
    const widths = passes.map(passLengthM)

    // Rows below y=40 should run the full 100m width; rows at/above y=40
    // (inside the notch) should be clipped down to 40m.
    expect(widths.some((w) => Math.abs(w - 100) < 1e-6)).toBe(true)
    expect(widths.some((w) => Math.abs(w - 40) < 1e-6)).toBe(true)
    // Nothing should be wider than the field itself.
    expect(Math.max(...widths)).toBeLessThanOrEqual(100 + 1e-6)
  })

  it('reconstructs the exact boundary area from covered strip area (rows tile with zero gap/overlap)', () => {
    const plan = planSprayPath({
      boundaryLocal: lShape,
      noSprayZonesLocal: [],
      droneProfile: profile({ swathM: 10 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    const totalSprayedLengthM = sprayingPasses(plan).reduce((sum, p) => sum + passLengthM(p), 0)
    const coveredAreaM2 = totalSprayedLengthM * 10 // swath width
    expect(coveredAreaM2).toBeCloseTo(6400, 6)
  })
})

describe('planSprayPath — no-spray zone splitting a sweep row', () => {
  const square: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  // A full-height strip from x=40 to x=60 — every horizontal row must
  // split into a left segment [0,40] and a right segment [60,100].
  const strip: LocalPoint[] = [
    { x: 40, y: -1 },
    { x: 60, y: -1 },
    { x: 60, y: 101 },
    { x: 40, y: 101 },
  ]

  it('produces two disjoint spray segments per row instead of one', () => {
    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [strip],
      droneProfile: profile({ swathM: 10 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    expect(plan.areaHa).toBeCloseTo(0.8, 6) // 10000 - 20*100 = 8000 m²

    const rowY = 5 // first row
    const onFirstRow = sprayingPasses(plan).filter((p) => p.start.y === rowY)
    const ranges = onFirstRow
      .map((p) => [Math.min(p.start.x, p.end.x), Math.max(p.start.x, p.end.x)] as [number, number])
      .sort((a, b) => a[0] - b[0])

    expect(ranges).toHaveLength(2)
    expect(ranges[0][0]).toBeCloseTo(0, 6)
    expect(ranges[0][1]).toBeCloseTo(40, 6)
    expect(ranges[1][0]).toBeCloseTo(60, 6)
    expect(ranges[1][1]).toBeCloseTo(100, 6)
  })

  it('splits every row, not just the first', () => {
    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [strip],
      droneProfile: profile({ swathM: 10 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    // 10 rows (y = 5..95 step 10), 2 segments each.
    expect(sprayingPasses(plan)).toHaveLength(20)
  })
})

describe('planSprayPath — tank capacity exceeded mid-field', () => {
  // A single 200m x 10m strip: one sweep row, one 200m pass.
  const strip: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 10 },
    { x: 0, y: 10 },
  ]

  it('splits the field-spanning pass into multiple tank-limited sorties', () => {
    // swath 10m, rate 100 L/ha, tank 5L => 50m affordable per tank =>
    // exactly 4 sorties for a 200m pass (matches droneProfile.test.ts's
    // direct splitIntoSorties case, exercised here through the full
    // planner pipeline instead of a hand-built pass list).
    const plan = planSprayPath({
      boundaryLocal: strip,
      noSprayZonesLocal: [],
      droneProfile: profile({ swathM: 10, applicationRateLPerHa: 100, tankL: 5 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    expect(plan.sorties).toHaveLength(4)
    for (const sortie of plan.sorties) {
      expect(sortie.volumeL).toBeLessThanOrEqual(5 + 1e-6)
    }
    expect(plan.totalVolumeL).toBeCloseTo(20, 6) // 2000 m² = 0.2 ha, * 100 L/ha
  })

  it('does not split when a bigger tank covers the whole field in one pass', () => {
    const plan = planSprayPath({
      boundaryLocal: strip,
      noSprayZonesLocal: [],
      droneProfile: profile({ swathM: 10, applicationRateLPerHa: 100, tankL: 100 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    expect(plan.sorties).toHaveLength(1)
    expect(plan.totalVolumeL).toBeCloseTo(20, 6)
  })
})

describe('planSprayPath — degenerate cases', () => {
  it('returns an empty plan when a no-spray zone consumes the entire field', () => {
    const square: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const coveringZone: LocalPoint[] = [
      { x: -5, y: -5 },
      { x: 15, y: -5 },
      { x: 15, y: 15 },
      { x: -5, y: 15 },
    ]

    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [coveringZone],
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })

    expect(plan.sorties).toHaveLength(0)
    expect(plan.areaHa).toBe(0)
    expect(plan.totalVolumeL).toBe(0)
  })
})

describe('planSprayPath — spacingOverrideM (Adjust Spacing, AeroGCS Green §11.3)', () => {
  const square: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  it('uses the override instead of the profile-derived swath spacing, producing more rows for a tighter value', () => {
    const wide = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile({ swathM: 10 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
    const tight = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile({ swathM: 10 }),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
      spacingOverrideM: 4,
    })

    const rowCount = (plan: ReturnType<typeof planSprayPath>) => sprayingPasses(plan).length
    expect(rowCount(tight)).toBeGreaterThan(rowCount(wide))
  })

  it('rejects a non-positive override rather than looping forever', () => {
    expect(() =>
      planSprayPath({
        boundaryLocal: square,
        noSprayZonesLocal: [],
        droneProfile: profile(),
        sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
        spacingOverrideM: 0,
      }),
    ).toThrow()
  })
})

describe('translateSprayPlan — Move Plan (AeroGCS Green §11.7)', () => {
  const square: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  it('shifts every pass by the offset and leaves totals unchanged', () => {
    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
    const moved = translateSprayPlan(plan, { x: 15, y: -7 })

    const originalPasses = plan.sorties.flatMap((s) => s.passes)
    const movedPasses = moved.sorties.flatMap((s) => s.passes)
    expect(movedPasses).toHaveLength(originalPasses.length)
    movedPasses.forEach((p, i) => {
      expect(p.start.x).toBeCloseTo(originalPasses[i].start.x + 15, 9)
      expect(p.start.y).toBeCloseTo(originalPasses[i].start.y - 7, 9)
      expect(p.end.x).toBeCloseTo(originalPasses[i].end.x + 15, 9)
      expect(p.end.y).toBeCloseTo(originalPasses[i].end.y - 7, 9)
    })

    // A pure translation changes no distances, volumes, or areas.
    expect(moved.totalDistanceM).toBeCloseTo(plan.totalDistanceM, 9)
    expect(moved.totalVolumeL).toBe(plan.totalVolumeL)
    expect(moved.areaHa).toBe(plan.areaHa)
  })

  it('returns the exact same object for a zero offset (no-op)', () => {
    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
    expect(translateSprayPlan(plan, { x: 0, y: 0 })).toBe(plan)
  })
})

describe('planStartPoint / planFinishPoint', () => {
  const square: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  it('returns the first spraying pass\'s start and the last spraying pass\'s end — not the transit legs to/from home', () => {
    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
    const sprayingPasses = plan.sorties.flatMap((s) => s.passes).filter((p) => p.spraying)

    expect(planStartPoint(plan)).toEqual(sprayingPasses[0].start)
    expect(planFinishPoint(plan)).toEqual(sprayingPasses[sprayingPasses.length - 1].end)
  })

  it('start and finish are never the same point when the route actually spans more than one row — every sortie is bookended by a transit leg to/from home, which would otherwise make both collapse onto the home point', () => {
    const plan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
    expect(planStartPoint(plan)).not.toEqual(planFinishPoint(plan))
  })

  it('returns null for an empty plan', () => {
    const emptyPlan = planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [
        [
          { x: -10, y: -10 },
          { x: 110, y: -10 },
          { x: 110, y: 110 },
          { x: -10, y: 110 },
        ],
      ], // a zone covering the whole field
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
    expect(emptyPlan.sorties).toHaveLength(0)
    expect(planStartPoint(emptyPlan)).toBeNull()
    expect(planFinishPoint(emptyPlan)).toBeNull()
  })
})

describe('splitPlanPasses — Plan Splitting (AeroGCS Green §11.8)', () => {
  const square: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  function buildPlan() {
    return planSprayPath({
      boundaryLocal: square,
      noSprayZonesLocal: [],
      droneProfile: profile({ tankL: 1000, enduranceMin: 999 }), // generous — a single sortie
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
    })
  }

  it('at 100%, includes every pass and excludes none', () => {
    const plan = buildPlan()
    const allPasses = plan.sorties.flatMap((s) => s.passes)
    const split = splitPlanPasses(plan, 100, 'from-start')
    expect(split.included).toEqual(allPasses)
    expect(split.excluded).toEqual([])
  })

  it('at 0%, excludes every pass and includes none', () => {
    const plan = buildPlan()
    const allPasses = plan.sorties.flatMap((s) => s.passes)
    const split = splitPlanPasses(plan, 0, 'from-start')
    expect(split.included).toEqual([])
    expect(split.excluded).toEqual(allPasses)
  })

  it('from-start: included is a prefix, excluded is the matching suffix', () => {
    const plan = buildPlan()
    const allPasses = plan.sorties.flatMap((s) => s.passes)
    const split = splitPlanPasses(plan, 50, 'from-start')

    expect(split.included).toEqual(allPasses.slice(0, split.included.length))
    expect(split.excluded).toEqual(allPasses.slice(split.included.length))
    expect(split.included.length + split.excluded.length).toBe(allPasses.length)
  })

  it('from-end: included is a suffix, excluded is the matching prefix', () => {
    const plan = buildPlan()
    const allPasses = plan.sorties.flatMap((s) => s.passes)
    const split = splitPlanPasses(plan, 50, 'from-end')

    expect(split.included).toEqual(allPasses.slice(allPasses.length - split.included.length))
    expect(split.excluded).toEqual(allPasses.slice(0, allPasses.length - split.included.length))
    expect(split.included.length + split.excluded.length).toBe(allPasses.length)
  })

  it('from-both: included is a prefix plus a matching suffix, excluded is the single chunk between them', () => {
    const plan = buildPlan()
    const allPasses = plan.sorties.flatMap((s) => s.passes)
    const split = splitPlanPasses(plan, 50, 'from-both')

    expect(split.included.length + split.excluded.length).toBe(allPasses.length)
    const halfCount = split.included.length / 2
    expect(split.included.slice(0, halfCount)).toEqual(allPasses.slice(0, halfCount))
    expect(split.included.slice(halfCount)).toEqual(allPasses.slice(allPasses.length - halfCount))
    expect(split.excluded).toEqual(allPasses.slice(halfCount, allPasses.length - halfCount))
  })

  it('from-both never overlaps its two chunks even when percent is close to 100', () => {
    const plan = buildPlan()
    const allPasses = plan.sorties.flatMap((s) => s.passes)
    const split = splitPlanPasses(plan, 90, 'from-both')

    expect(split.included.length + split.excluded.length).toBe(allPasses.length)
    // No pass appears in both included and excluded.
    const includedSet = new Set(split.included)
    for (const p of split.excluded) expect(includedSet.has(p)).toBe(false)
  })
})
