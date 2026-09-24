import { describe, expect, it } from 'vitest'
import { createBoundary } from '@/lib/geo/boundary'
import { createLocalProjection } from '@/lib/geo/projection'
import type { DroneProfile, FieldBoundary, LatLng, NoSprayZone } from '@/lib/geo/types'
import { boundaryHasCorrections, runSessionBlindVsSighted } from './sessionScenario'

const ORIGIN: LatLng = { lon: 75.75, lat: 30.35 }

const profile = (overrides: Partial<DroneProfile> = {}): DroneProfile => ({
  id: 'test',
  name: 'Test rig',
  swathM: 10,
  speedMps: 5,
  tankL: 1000,
  applicationRateLPerHa: 15,
  altitudeM: 3,
  enduranceMin: 60,
  turnPenaltySec: 5,
  ...overrides,
})

const projection = createLocalProjection(ORIGIN)

// A 100m x 50m rectangle around the origin, as satellite-traced.
const IMPORTED_VERTICES: LatLng[] = [
  projection.toLatLng({ x: -50, y: -25 }),
  projection.toLatLng({ x: 50, y: -25 }),
  projection.toLatLng({ x: 50, y: 25 }),
  projection.toLatLng({ x: -50, y: 25 }),
]

function importedBoundary(): FieldBoundary {
  return createBoundary(IMPORTED_VERTICES, 'satellite-trace', { imageryDate: '2026-01-01' })
}

describe('boundaryHasCorrections', () => {
  it('is false for the exact same boundary the pilot just imported', () => {
    const original = importedBoundary()
    // Same object, as the store snapshots it — but also verify the
    // positional-equality path independently, with a structurally
    // identical (not reference-identical) clone.
    const clone: FieldBoundary = JSON.parse(JSON.stringify(original))
    expect(boundaryHasCorrections(original, original)).toBe(false)
    expect(boundaryHasCorrections(original, clone)).toBe(false)
  })

  it('is true once an edge is walked (vertices spliced in, edge count grows)', () => {
    const original = importedBoundary()
    const walked: FieldBoundary = {
      ...original,
      vertices: [...original.vertices, projection.toLatLng({ x: 0, y: -30 })], // a spliced-in point
      edges: [
        ...original.edges.slice(0, -1),
        { id: 'e0-walk0', fromIndex: 0, toIndex: 4, provenance: { kind: 'walked', accuracyM: 2 } },
        { id: 'e0-walk1', fromIndex: 4, toIndex: 1, provenance: { kind: 'walked', accuracyM: 2 } },
      ],
    }
    expect(boundaryHasCorrections(original, walked)).toBe(true)
  })

  it('is true when only an edge\'s risk was accepted (vertices unchanged, provenance flipped)', () => {
    const original = importedBoundary()
    const riskAccepted: FieldBoundary = {
      ...original,
      edges: original.edges.map((e, i) => (i === 0 ? { ...e, provenance: { ...e.provenance, acceptedRisk: true } } : e)),
    }
    expect(boundaryHasCorrections(original, riskAccepted)).toBe(true)
  })
})

describe('runSessionBlindVsSighted', () => {
  const zones: NoSprayZone[] = []

  it('produces identical Blind and Sighted results when nothing has been corrected', () => {
    const boundary = importedBoundary()
    const result = runSessionBlindVsSighted({
      originalBoundary: boundary,
      currentBoundary: boundary,
      noSprayZones: zones,
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
      projection,
    })

    expect(result.blindResult.coveragePct).toBeCloseTo(result.sightedResult.coveragePct, 6)
    expect(result.blindResult.oversprayPct).toBeCloseTo(result.sightedResult.oversprayPct, 6)
  })

  it('scores Blind against the ORIGINAL boundary and Sighted against the CURRENT (corrected) boundary, both relative to current-boundary ground truth', () => {
    const original = importedBoundary()
    // The pilot trimmed 20m off the right edge — a real, geometry-changing correction.
    const correctedVertices: LatLng[] = [
      projection.toLatLng({ x: -50, y: -25 }),
      projection.toLatLng({ x: 30, y: -25 }), // was x: 50
      projection.toLatLng({ x: 30, y: 25 }), // was x: 50
      projection.toLatLng({ x: -50, y: 25 }),
    ]
    const corrected: FieldBoundary = { ...original, vertices: correctedVertices }

    const result = runSessionBlindVsSighted({
      originalBoundary: original,
      currentBoundary: corrected,
      noSprayZones: zones,
      droneProfile: profile(),
      sweepStrategy: { kind: 'fixed-heading', headingDeg: 0 },
      projection,
    })

    // Ground truth is the corrected (smaller) field — the Blind plan was
    // built from the original (bigger, now-wrong) boundary, so it
    // oversprays onto what's no longer part of the field.
    expect(result.groundTruthLocal).toEqual(result.sightedBoundaryLocal)
    // The Blind plan sprays out to the original (now-wrong, wider) edge —
    // onto ground that's no longer part of the field — so it oversprays.
    // The Sighted plan was built from the exact boundary it's scored
    // against, so it doesn't.
    expect(result.blindResult.oversprayPct).toBeGreaterThan(0)
    expect(result.sightedResult.oversprayPct).toBeCloseTo(0, 1)
    expect(result.sightedResult.wastedCostInr).toBeLessThan(result.blindResult.wastedCostInr)
  })
})
