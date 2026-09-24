import { describe, expect, it } from 'vitest'
import { createBoundary } from './boundary'
import { computeReadiness } from './readiness'
import type { LatLng, LocalPoint } from './types'

// A simple 10x10 square, used purely for edge-length math — degrees here
// don't matter since computeReadiness works off the supplied LocalPoint
// vertices, not the LatLng ones.
const vertices: LatLng[] = [
  { lon: 0, lat: 0 },
  { lon: 0.0001, lat: 0 },
  { lon: 0.0001, lat: 0.0001 },
  { lon: 0, lat: 0.0001 },
]
const localVertices: LocalPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('computeReadiness', () => {
  it('is not cleared when a freshly-imported satellite boundary has no verified edges', () => {
    const boundary = createBoundary(vertices, 'satellite-trace', { imageryDate: '2024-01-01' })
    const readiness = computeReadiness(boundary, localVertices)

    expect(readiness.cleared).toBe(false)
    expect(readiness.unverifiedEdges).toBe(4)
    expect(readiness.unverifiedLengthM).toBeCloseTo(40, 6)
    expect(readiness.blockingEdgeIds).toEqual(['e0', 'e1', 'e2', 'e3'])
  })

  it('is cleared once every edge is walked', () => {
    const boundary = createBoundary(vertices, 'gps-walk', { accuracyM: 3 })
    const readiness = computeReadiness(boundary, localVertices)

    expect(readiness.cleared).toBe(true)
    expect(readiness.unverifiedEdges).toBe(0)
    expect(readiness.blockingEdgeIds).toEqual([])
  })

  it('clears a satellite edge whose risk was explicitly accepted, without counting it as verified', () => {
    const boundary = createBoundary(vertices, 'satellite-trace', { imageryDate: '2024-01-01' })
    boundary.edges[0].provenance.acceptedRisk = true

    const readiness = computeReadiness(boundary, localVertices)

    expect(readiness.unverifiedEdges).toBe(3)
    expect(readiness.acceptedRiskEdges).toBe(1)
    expect(readiness.blockingEdgeIds).not.toContain('e0')
    expect(readiness.cleared).toBe(false) // the other 3 edges still block
  })

  it('is only cleared once the last blocking edge is resolved', () => {
    const boundary = createBoundary(vertices, 'satellite-trace', { imageryDate: '2024-01-01' })
    for (const edge of boundary.edges) {
      edge.provenance.kind = 'confirmed'
    }
    const readiness = computeReadiness(boundary, localVertices)
    expect(readiness.cleared).toBe(true)
  })
})
