import { kinks, polygon as turfPolygon } from '@turf/turf'
import { describe, expect, it } from 'vitest'
import { createBoundary } from './boundary'
import { acceptEdgeRisk, applyWalkedEdgeCorrection, DeltaError, revokeAcceptedRisk } from './delta'
import { polygonAreaM2 } from './math'
import { createLocalProjection, projectAll, unprojectAll } from './projection'
import type { LatLng, LocalPoint } from './types'

// applyWalkedEdgeCorrection now needs a real LocalProjection (simplification
// and the self-intersection check both run in real meters), so these
// fixtures are defined in local meters for readability and then unprojected
// to real lon/lat around a fixed origin — the same pattern the rest of the
// codebase's test fixtures use (see e.g. lib/export/testFixtures.ts).
const ORIGIN: LatLng = { lon: 75.75, lat: 30.35 }
const projection = createLocalProjection(ORIGIN)

// 100m x 100m square, bottom edge at y=-50.
const SQUARE_LOCAL: LocalPoint[] = [
  { x: -50, y: -50 },
  { x: 50, y: -50 },
  { x: 50, y: 50 },
  { x: -50, y: 50 },
]
const square: LatLng[] = unprojectAll(projection, SQUARE_LOCAL)

function asLocal(vertices: LatLng[]): LocalPoint[] {
  return projectAll(projection, vertices)
}

function toLatLng(points: LocalPoint[]): LatLng[] {
  return unprojectAll(projection, points)
}

function isValidSimplePolygon(vertices: LatLng[]): boolean {
  const ring = asLocal(vertices).map((p): [number, number] => [p.x, p.y])
  ring.push(ring[0])
  return kinks(turfPolygon([ring])).features.length === 0
}

describe('applyWalkedEdgeCorrection', () => {
  it('adds a strip when the walked trace falls outside the boundary', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

    // A newly-planted strip below the satellite-drawn bottom edge (y=-50 -> y=-52).
    const walked = toLatLng([
      { x: -20, y: -52 },
      { x: 20, y: -52 },
    ])

    const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)

    const oldArea = polygonAreaM2(asLocal(boundary.vertices))
    const newArea = polygonAreaM2(asLocal(updated.vertices))
    expect(newArea).toBeGreaterThan(oldArea)

    // The original edge is gone, replaced by a walked chain (2 points -> 3 edges).
    expect(updated.edges.find((e) => e.id === bottomEdge.id)).toBeUndefined()
    const newEdges = updated.edges.filter((e) => e.id.startsWith(`${bottomEdge.id}-walk`))
    expect(newEdges).toHaveLength(3)
    expect(newEdges.every((e) => e.provenance.kind === 'walked' && e.provenance.accuracyM === 3)).toBe(true)
  })

  it('trims the boundary when the walked trace falls inside it', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

    // The satellite overestimated the field — actual edge is 2m further in (y=-50 -> y=-48).
    const walked = toLatLng([
      { x: -20, y: -48 },
      { x: 20, y: -48 },
    ])

    const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 4, projection)

    const oldArea = polygonAreaM2(asLocal(boundary.vertices))
    const newArea = polygonAreaM2(asLocal(updated.vertices))
    expect(newArea).toBeLessThan(oldArea)
  })

  it('leaves every other edge — id, indices, and provenance — untouched', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!
    const otherEdges = boundary.edges.filter((e) => e.id !== bottomEdge.id)

    const walked = toLatLng([{ x: 0, y: -51 }])
    const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)

    for (const before of otherEdges) {
      const after = updated.edges.find((e) => e.id === before.id)
      expect(after).toBeDefined()
      expect(after!.provenance).toEqual(before.provenance)
    }
    // Total edge count: 3 untouched + (1 walked point -> 2 new edges).
    expect(updated.edges).toHaveLength(otherEdges.length + 2)
  })

  it('splices correctly across the wrap-around edge (last vertex -> first vertex)', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const wrapEdge = boundary.edges.find((e) => e.fromIndex === 3 && e.toIndex === 0)!

    const walked = toLatLng([{ x: -52, y: 0 }])
    const updated = applyWalkedEdgeCorrection(boundary, wrapEdge.id, walked, 3, projection)

    // Original 4 vertices + 1 inserted; the untouched edges still close the ring.
    expect(updated.vertices).toHaveLength(5)
    const newArea = polygonAreaM2(asLocal(updated.vertices))
    const oldArea = polygonAreaM2(asLocal(boundary.vertices))
    expect(newArea).toBeGreaterThan(oldArea) // bulges outward past x=-50

    // 3 untouched edges + 2 replacing the wrap edge (1 inserted point -> 2 edges).
    expect(updated.edges).toHaveLength(5)
  })

  it('throws for an unknown edge id', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const walked = toLatLng([{ x: 0, y: 0 }])
    expect(() => applyWalkedEdgeCorrection(boundary, 'nope', walked, 3, projection)).toThrow(DeltaError)
  })

  it('throws when given an empty trace', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    expect(() => applyWalkedEdgeCorrection(boundary, boundary.edges[0].id, [], 3, projection)).toThrow(DeltaError)
  })

  describe('trace simplification (the edge-count-explosion bug)', () => {
    it('collapses a many-point GPS-style walk down to a small number of clean edges, not one edge per input point', () => {
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      // Simulates a real trim: GPS sampled once a second over a ~15s walk
      // along a roughly straight line 20m inside the original edge, with
      // small (<1m) point-to-point jitter — exactly the shape a Web
      // Serial-fed real GPS walk would produce. 15 points; the bug this
      // fixes would have turned this into 15 tiny "walked" edges.
      const rawTraceLocal: LocalPoint[] = Array.from({ length: 15 }, (_, i) => ({
        x: -20 + i * 2.8, // spans ~-20 to ~19.2m
        y: -30 + (i % 2 === 0 ? 0.4 : -0.4), // small jitter around y=-30
      }))
      const walked = toLatLng(rawTraceLocal)

      const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)

      const newEdges = updated.edges.filter((e) => e.id.startsWith(`${bottomEdge.id}-walk`))
      expect(newEdges.length).toBeLessThan(rawTraceLocal.length)
      expect(newEdges.length).toBeLessThanOrEqual(6)
      expect(updated.edges.length).toBeLessThan(20) // vs. 154+ before the fix (3 untouched + 15 raw points -> 16 edges, times the boundary's real vertex count in the reported repro)
    })

    it('still trims correctly (loses area) after simplifying a many-point trace', () => {
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      const rawTraceLocal: LocalPoint[] = Array.from({ length: 15 }, (_, i) => ({
        x: -20 + i * 2.8,
        y: -30 + (i % 2 === 0 ? 0.4 : -0.4),
      }))
      const walked = toLatLng(rawTraceLocal)

      const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)

      const oldArea = polygonAreaM2(asLocal(boundary.vertices))
      const newArea = polygonAreaM2(asLocal(updated.vertices))
      expect(newArea).toBeLessThan(oldArea) // trimmed inward, same as the un-simplified version would
    })
  })

  describe('polygon validity (the self-intersection / stray-diagonal bug)', () => {
    it('produces a valid, non-self-intersecting polygon after a normal trim', () => {
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      const walked = toLatLng([
        { x: -25, y: -30 },
        { x: 0, y: -32 },
        { x: 25, y: -30 },
      ])
      const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)

      expect(isValidSimplePolygon(updated.vertices)).toBe(true)
    })

    it('rejects (throws DeltaError) a trace that crosses itself, instead of producing an invalid polygon', () => {
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      // A bowtie: A -> B -> C -> D where segment A-B and segment C-D cross
      // in the middle. Each point is >=20m from the line through its
      // neighbors, so simplification can't (and shouldn't) simplify this
      // away — it's a genuine self-crossing shape, not jitter noise.
      const walked = toLatLng([
        { x: -20, y: -10 }, // A
        { x: 20, y: -30 }, // B
        { x: -20, y: -30 }, // C
        { x: 20, y: -10 }, // D
      ])

      expect(() => applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)).toThrow(DeltaError)
    })

    it('rejects a trace that would cross an untouched part of the boundary, not just itself', () => {
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      // A single point far out past the square's right edge (x=50). The
      // straight connector from the bottom-left anchor (-50,-50) to this
      // point crosses the untouched right edge (the old (50,-50)-(50,50)
      // segment, still part of the ring) at roughly (50, -8), well within
      // that edge's span — a genuine crossing with a part of the boundary
      // this correction never touched, not just a self-crossing trace.
      const walked = toLatLng([{ x: 70, y: 0 }])

      expect(() => applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)).toThrow(DeltaError)
    })
  })

  describe('plausibility guard (straying far from the edge being corrected)', () => {
    it('rejects a trace that starts near the edge, wanders deep into the interior with a sharp turn, and ends near a different part of the boundary', () => {
      // Reproduces the exact reported bug: a trace that goes from near
      // the target (bottom) edge, straight up into the middle of the
      // 100x100m field (70m off the edge's own line — deep interior,
      // nowhere near "correcting this edge"), a sharp turn, then back
      // down past the boundary on the far side. This is NOT
      // self-intersecting (it's a simple zigzag, so turf's kinks() alone
      // wouldn't catch it) but is wildly implausible as a single-edge
      // correction, which is exactly what this guard is for.
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      const walked = toLatLng([
        { x: -30, y: -48 }, // starts close to the edge, plausible
        { x: -10, y: 20 }, // sharp turn deep into the interior — 70m off the edge's line
        { x: 40, y: -60 }, // ends past the boundary, near a different part of it
      ])

      expect(() => applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)).toThrow(DeltaError)
      expect(() => applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)).toThrow(/strays too far/)
    })

    it('does not reject a legitimate, substantial-but-local trim that stays within a sane fraction of the field', () => {
      // A real correction can still move an edge by tens of meters — this
      // shouldn't get caught by the same guard that rejects the wild
      // interior excursion above. 25m off a 100m-square edge (well under
      // the ~42m allowance for this field) is a big trim, not a redraw.
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!

      const walked = toLatLng([
        { x: -25, y: -25 },
        { x: 25, y: -25 },
      ])

      expect(() => applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)).not.toThrow()
    })

    it('only touches the target edge — every untouched edge keeps its exact original geometry even when the correction is rejected or accepted', () => {
      const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
      const bottomEdge = boundary.edges.find((e) => e.fromIndex === 0 && e.toIndex === 1)!
      const otherEdgesBefore = boundary.edges.filter((e) => e.id !== bottomEdge.id)

      const walked = toLatLng([
        { x: -25, y: -25 },
        { x: 25, y: -25 },
      ])
      const updated = applyWalkedEdgeCorrection(boundary, bottomEdge.id, walked, 3, projection)

      // Confirms the answer to "is the merge logic correctly scoped to
      // just this edge" is yes: every OTHER edge's endpoints are
      // identical (up to reindexing) to their original coordinates —
      // nothing about the rest of the polygon moved.
      for (const before of otherEdgesBefore) {
        const after = updated.edges.find((e) => e.id === before.id)!
        const beforeA = boundary.vertices[before.fromIndex]
        const beforeB = boundary.vertices[before.toIndex]
        const afterA = updated.vertices[after.fromIndex]
        const afterB = updated.vertices[after.toIndex]
        expect(afterA).toEqual(beforeA)
        expect(afterB).toEqual(beforeB)
      }
    })
  })
})

describe('acceptEdgeRisk', () => {
  it('sets acceptedRisk without changing geometry, edge count, or provenance.kind', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const edge = boundary.edges[0]

    const updated = acceptEdgeRisk(boundary, edge.id)

    expect(updated.vertices).toEqual(boundary.vertices)
    expect(updated.edges).toHaveLength(boundary.edges.length)

    const updatedEdge = updated.edges.find((e) => e.id === edge.id)!
    expect(updatedEdge.provenance.kind).toBe('satellite') // still satellite, not "walked" — this is the whole distinction
    expect(updatedEdge.provenance.acceptedRisk).toBe(true)

    for (const other of boundary.edges.filter((e) => e.id !== edge.id)) {
      expect(updated.edges.find((e) => e.id === other.id)!.provenance).toEqual(other.provenance)
    }
  })

  it('throws when accepting risk on an edge that is not a satellite prior', () => {
    const boundary = createBoundary(square, 'gps-walk', { accuracyM: 3 })
    expect(() => acceptEdgeRisk(boundary, boundary.edges[0].id)).toThrow(DeltaError)
  })
})

describe('revokeAcceptedRisk', () => {
  it('reverses acceptEdgeRisk', () => {
    const boundary = createBoundary(square, 'satellite-trace', { imageryDate: '2024-01-01' })
    const edge = boundary.edges[0]

    const accepted = acceptEdgeRisk(boundary, edge.id)
    const revoked = revokeAcceptedRisk(accepted, edge.id)

    expect(revoked.edges.find((e) => e.id === edge.id)!.provenance.acceptedRisk).toBe(false)
  })
})
