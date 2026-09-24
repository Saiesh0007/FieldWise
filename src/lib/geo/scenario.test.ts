/**
 * End-to-end sanity check for the whole geometry-core pipeline, run once
 * on a realistic-shaped field before this layer gets wired into the map
 * UI: lat/lng boundary -> local projection -> no-spray zone -> sweep plan
 * -> readiness. Logs a human-readable summary so the numbers can be
 * eyeballed, and asserts internal consistency (not just "it doesn't
 * throw") so a real regression still fails the suite.
 */
import { describe, expect, it } from 'vitest'
import { createBoundary } from './boundary'
import { DEFAULT_DRONE_PROFILE } from './defaults'
import { polygonAreaM2 } from './math'
import { multiPolygonAreaM2, subtractNoSprayZones } from './noSprayZones'
import { planSprayPath } from './planner'
import { approximateCentroidLatLng, createLocalProjection, projectAll } from './projection'
import { computeReadiness } from './readiness'
import type { LatLng } from './types'

describe('scenario: an L-shaped field with a pond and one freshly-walked edge', () => {
  // An L-shaped field near Mysuru, India — roughly 270m x 200m overall,
  // with the top-left corner missing (imagine: a strip recently taken out
  // of production). Vertex order is CCW.
  const fieldVertices: LatLng[] = [
    { lon: 76.6, lat: 12.3 },
    { lon: 76.6025, lat: 12.3 },
    { lon: 76.6025, lat: 12.301 },
    { lon: 76.6015, lat: 12.301 },
    { lon: 76.6015, lat: 12.3018 },
    { lon: 76.6, lat: 12.3018 },
  ]

  // A small pond/obstacle inside the larger part of the field.
  const pondVertices: LatLng[] = [
    { lon: 76.6005, lat: 12.3002 },
    { lon: 76.601, lat: 12.3002 },
    { lon: 76.601, lat: 12.3006 },
    { lon: 76.6005, lat: 12.3006 },
  ]

  const origin = approximateCentroidLatLng(fieldVertices)
  const projection = createLocalProjection(origin)
  const boundaryLocal = projectAll(projection, fieldVertices)
  const pondLocal = projectAll(projection, pondVertices)

  const boundary = createBoundary(fieldVertices, 'satellite-trace', { imageryDate: '2024-11-01' })
  // The pilot just walked the edge that closes off the notch (v4 -> v5) —
  // this is the "recently changed crop line" the twist is about.
  const walkedEdge = boundary.edges.find((e) => e.fromIndex === 4 && e.toIndex === 5)!
  walkedEdge.provenance = { kind: 'walked', accuracyM: 2.1, verifiedAt: new Date().toISOString() }

  const readiness = computeReadiness(boundary, boundaryLocal)

  const plan = planSprayPath({
    boundaryLocal,
    noSprayZonesLocal: [pondLocal],
    droneProfile: DEFAULT_DRONE_PROFILE,
    sweepStrategy: { kind: 'min-turns' },
  })

  it('logs a human-readable summary', () => {
    const sprayableArea = multiPolygonAreaM2(subtractNoSprayZones(boundaryLocal, [pondLocal]), polygonAreaM2)

    console.log('\n--- FieldWise geometry-core scenario ---')
    console.log(`Projection origin: ${origin.lon.toFixed(5)}, ${origin.lat.toFixed(5)}`)
    console.log(`Sprayable area: ${(sprayableArea / 10_000).toFixed(3)} ha (${sprayableArea.toFixed(0)} m²)`)
    console.log(`Resolved sweep heading: ${plan.headingDeg.toFixed(1)}°`)
    console.log(`Drone profile: ${DEFAULT_DRONE_PROFILE.name} (swath ${DEFAULT_DRONE_PROFILE.swathM}m, tank ${DEFAULT_DRONE_PROFILE.tankL}L)`)
    console.log(
      `Readiness: ${readiness.cleared ? 'CLEARED' : 'NOT CLEARED'} — ${readiness.unverifiedEdges}/${readiness.totalEdges} edges unverified (${readiness.unverifiedLengthM.toFixed(1)}m), blocking: [${readiness.blockingEdgeIds.join(', ')}]`,
    )
    console.log(`Sorties: ${plan.sorties.length}`)
    console.table(
      plan.sorties.map((s) => ({
        sortie: s.index,
        passes: s.passes.filter((p) => p.spraying).length,
        distanceM: Number(s.distanceM.toFixed(1)),
        volumeL: Number(s.volumeL.toFixed(2)),
        minutes: Number(s.estimatedMinutes.toFixed(2)),
      })),
    )
    console.log(
      `Totals: ${plan.totalDistanceM.toFixed(1)}m, ${plan.totalVolumeL.toFixed(2)}L, ${plan.totalEstimatedMinutes.toFixed(1)} min, ${plan.areaHa.toFixed(3)} ha`,
    )
    console.log('-----------------------------------------\n')

    expect(true).toBe(true) // this test's job is the log above; assertions below cover correctness
  })

  it('projects a sensible field size (a few hundred meters, not degrees-as-meters)', () => {
    const xs = boundaryLocal.map((p) => p.x)
    const ys = boundaryLocal.map((p) => p.y)
    const widthM = Math.max(...xs) - Math.min(...xs)
    const heightM = Math.max(...ys) - Math.min(...ys)

    expect(widthM).toBeGreaterThan(200)
    expect(widthM).toBeLessThan(300)
    expect(heightM).toBeGreaterThan(150)
    expect(heightM).toBeLessThan(250)
  })

  it('readiness reflects the one walked edge and blocks on the rest', () => {
    expect(readiness.cleared).toBe(false)
    expect(readiness.unverifiedEdges).toBe(boundary.edges.length - 1)
    expect(readiness.blockingEdgeIds).not.toContain(walkedEdge.id)
  })

  it('plan area matches the boundary-minus-pond area computed independently', () => {
    const expectedAreaM2 = multiPolygonAreaM2(subtractNoSprayZones(boundaryLocal, [pondLocal]), polygonAreaM2)
    expect(plan.areaHa * 10_000).toBeCloseTo(expectedAreaM2, 3)
  })

  it('produces a non-empty, internally consistent plan', () => {
    expect(plan.sorties.length).toBeGreaterThan(0)
    expect(plan.totalVolumeL).toBeGreaterThan(0)
    expect(plan.totalDistanceM).toBeGreaterThan(0)

    const recomputedVolume = plan.sorties.reduce((sum, s) => sum + s.volumeL, 0)
    expect(recomputedVolume).toBeCloseTo(plan.totalVolumeL, 6)

    for (const sortie of plan.sorties) {
      expect(sortie.volumeL).toBeLessThanOrEqual(DEFAULT_DRONE_PROFILE.tankL + 1e-6)
    }
  })
})
