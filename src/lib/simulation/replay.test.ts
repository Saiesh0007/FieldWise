import { describe, expect, it } from 'vitest'
import { planSprayPath } from '@/lib/geo/planner'
import type { DroneProfile, LocalPoint } from '@/lib/geo/types'
import { simulateSprayReplay } from './replay'

const profile = (overrides: Partial<DroneProfile> = {}): DroneProfile => ({
  id: 'test',
  name: 'Test rig',
  swathM: 10,
  speedMps: 5,
  tankL: 1000, // generous — sortie splitting isn't what these tests are about
  applicationRateLPerHa: 15,
  altitudeM: 3,
  enduranceMin: 60,
  turnPenaltySec: 5,
  ...overrides,
})

const groundTruth: LocalPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
] // 100m x 50m = 5000 m^2 = 0.5 ha

function planFor(boundaryLocal: LocalPoint[], droneProfile: DroneProfile) {
  return planSprayPath({
    boundaryLocal,
    noSprayZonesLocal: [],
    droneProfile,
    sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 }, // deterministic: rows horizontal, sweep along x
  })
}

describe('simulateSprayReplay — blind misses a strip entirely', () => {
  // Satellite boundary is 20m narrower than ground truth (a newly-planted
  // strip the stale imagery doesn't show yet) — otherwise identical.
  const blindBoundary: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 50 },
    { x: 0, y: 50 },
  ]

  it('reports coverage well under 100% and a nonzero missed area matching the strip', () => {
    const plan = planFor(blindBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })

    // The missing strip is 20m x 50m = 1000 m^2 = 0.1 ha, i.e. 20% of the 0.5ha ground truth.
    expect(result.coveragePct).toBeGreaterThan(75)
    expect(result.coveragePct).toBeLessThan(85)
    expect(result.missedAreaHa).toBeGreaterThan(0.08)
    expect(result.missedAreaHa).toBeLessThan(0.12)
  })

  it('does not report meaningful overspray when the blind boundary never leaves the ground truth', () => {
    const plan = planFor(blindBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })
    expect(result.oversprayPct).toBeLessThan(1)
    expect(result.wastedLiters).toBeLessThan(0.5)
  })

  it('marks cells in the missed strip as "missed", not "covered" or silently absent', () => {
    const plan = planFor(blindBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })

    const missedStripCell = result.heatmap.cells.find((c) => c.cx > 85 && c.cx < 95 && c.cy > 20 && c.cy < 30)
    expect(missedStripCell).toBeDefined()
    expect(missedStripCell!.state).toBe('missed')
    expect(missedStripCell!.doseOrder).toBeNull()
  })
})

describe('simulateSprayReplay — blind oversprays past the true boundary', () => {
  // Satellite boundary extends 10m past the true top edge across the full
  // width (a stale crop line encroaching onto what's now neighboring land).
  const blindBoundary: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 0, y: 60 },
  ]

  it('reports nonzero overspray, wasted litres, and wasted cost', () => {
    const plan = planFor(blindBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })

    // The over-sprayed strip is 100m x 10m = 1000 m^2 = 0.1 ha, i.e. 20% of the 0.5ha ground truth.
    expect(result.oversprayPct).toBeGreaterThan(15)
    expect(result.oversprayPct).toBeLessThan(25)
    expect(result.oversprayAreaHa).toBeGreaterThan(0.08)
    expect(result.wastedLiters).toBeGreaterThan(0)
    expect(result.wastedCostInr).toBeGreaterThan(0)
    expect(result.wastedCostInr).toBeCloseTo(result.wastedLiters * 250, 4) // default illustrative price
  })

  it('still covers the ground truth fully, since the blind boundary is a superset of it here', () => {
    const plan = planFor(blindBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })
    expect(result.coveragePct).toBeGreaterThan(95)
  })

  it('marks cells beyond the true edge as "overspray" with a real doseOrder', () => {
    const plan = planFor(blindBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })

    const oversprayCell = result.heatmap.cells.find((c) => c.cx > 40 && c.cx < 60 && c.cy > 52 && c.cy < 58)
    expect(oversprayCell).toBeDefined()
    expect(oversprayCell!.state).toBe('overspray')
    expect(oversprayCell!.doseOrder).not.toBeNull()
  })
})

describe('simulateSprayReplay — sighted matches ground truth closely', () => {
  // A realistically-imperfect GPS-walked correction: each vertex is off
  // by well under a meter, not a pixel-perfect copy of ground truth.
  const sightedBoundary: LocalPoint[] = [
    { x: 0.3, y: -0.2 },
    { x: 99.7, y: 0.4 },
    { x: 100.2, y: 49.6 },
    { x: -0.4, y: 50.3 },
  ]

  it('achieves near-100% coverage and near-0% overspray', () => {
    const plan = planFor(sightedBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })

    expect(result.coveragePct).toBeGreaterThan(95)
    expect(result.oversprayPct).toBeLessThan(5)
  })

  it('wastes only a small amount of chemical, if any', () => {
    const plan = planFor(sightedBoundary, profile())
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile() })
    expect(result.wastedLiters).toBeLessThan(1)
  })
})

describe('simulateSprayReplay — general behavior', () => {
  it('assigns strictly increasing doseOrder values in pass order (first pass to reach a cell claims it)', () => {
    const plan = planFor(groundTruth, profile({ swathM: 10 }))
    const result = simulateSprayReplay({ groundTruthLocal: groundTruth, plan, droneProfile: profile({ swathM: 10 }) })

    const orders = result.heatmap.cells.map((c) => c.doseOrder).filter((o): o is number => o !== null)
    expect(orders.length).toBeGreaterThan(0)
    expect(Math.min(...orders)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...orders)).toBeLessThan(result.heatmap.totalPasses)
  })

  it('throws for a degenerate ground truth polygon', () => {
    const plan = planFor(groundTruth, profile())
    expect(() =>
      simulateSprayReplay({ groundTruthLocal: [{ x: 0, y: 0 }, { x: 1, y: 1 }], plan, droneProfile: profile() }),
    ).toThrow()
  })
})
