import { describe, expect, it } from 'vitest'
import { circleToPolygon } from './circleObstacle'
import { polygonAreaM2 } from './math'
import { subtractNoSprayZones, multiPolygonAreaM2 } from './noSprayZones'
import { createLocalProjection, projectAll } from './projection'
import type { LatLng } from './types'

const CENTER: LatLng = { lon: 75.751, lat: 30.351 }

describe('circleToPolygon', () => {
  it('rejects a non-positive radius', () => {
    expect(() => circleToPolygon(CENTER, 0)).toThrow()
    expect(() => circleToPolygon(CENTER, -5)).toThrow()
  })

  it('produces a closed-shape ring (no repeated vertex) with the requested vertex count', () => {
    const ring = circleToPolygon(CENTER, 20, 16)
    expect(ring).toHaveLength(16)
    const first = ring[0]
    const last = ring[ring.length - 1]
    expect(first).not.toEqual(last)
  })

  it('places every vertex within a fraction of a percent of the requested radius', () => {
    const radiusM = 25
    const ring = circleToPolygon(CENTER, radiusM, 32)
    const projection = createLocalProjection(CENTER)
    const local = projectAll(projection, ring)

    for (const p of local) {
      const dist = Math.hypot(p.x, p.y)
      expect(dist).toBeCloseTo(radiusM, 0) // within half a meter
    }
  })

  it('approximates a circle\'s area (πr²) once projected to local meters', () => {
    const radiusM = 30
    const ring = circleToPolygon(CENTER, radiusM, 64)
    const projection = createLocalProjection(CENTER)
    const local = projectAll(projection, ring)

    const area = polygonAreaM2(local)
    const expected = Math.PI * radiusM * radiusM
    // A 64-gon inscribed in the circle is necessarily a little smaller than
    // the true circle — bound it as a percentage rather than an absolute
    // vitest digit, which is the right way to express "close enough" for a
    // polygon approximation of a curve.
    expect(area).toBeGreaterThan(expected * 0.99)
    expect(area).toBeLessThanOrEqual(expected)
  })
})

describe('circle obstacle differencing against a boundary', () => {
  it('subtracts a circular obstacle fully inside the field, punching a hole of ~πr²', () => {
    const boundaryOrigin: LatLng = { lon: 75.75, lat: 30.35 }
    // ~100m x ~100m square around the origin, built directly in local space for an exact expected area.
    const boundaryLocal = [
      { x: -50, y: -50 },
      { x: 50, y: -50 },
      { x: 50, y: 50 },
      { x: -50, y: 50 },
    ]

    const projection = createLocalProjection(boundaryOrigin)
    const radiusM = 15
    const circleCenterLatLng = projection.toLatLng({ x: 0, y: 0 })
    const circleRing = circleToPolygon(circleCenterLatLng, radiusM, 64)
    const circleLocal = projectAll(projection, circleRing)

    const result = subtractNoSprayZones(boundaryLocal, [circleLocal])

    expect(result).toHaveLength(1) // one polygon, with a hole
    expect(result[0].length).toBe(2) // outer ring + the circular hole

    const sprayableArea = multiPolygonAreaM2(result, polygonAreaM2)
    const expectedArea = 100 * 100 - Math.PI * radiusM * radiusM
    // Same polygon-approximation slack as above, just inverted (the hole is
    // slightly undersized, so sprayable area is slightly larger than exact).
    expect(sprayableArea).toBeGreaterThanOrEqual(expectedArea)
    expect(sprayableArea).toBeLessThan(expectedArea + 5)
  })

  it('clips a circular obstacle that straddles the boundary edge', () => {
    const boundaryOrigin: LatLng = { lon: 75.75, lat: 30.35 }
    const boundaryLocal = [
      { x: -50, y: -50 },
      { x: 50, y: -50 },
      { x: 50, y: 50 },
      { x: -50, y: 50 },
    ]

    const projection = createLocalProjection(boundaryOrigin)
    const radiusM = 20
    // Centered right on the eastern edge — half the circle sticks outside the field.
    const circleCenterLatLng = projection.toLatLng({ x: 50, y: 0 })
    const circleRing = circleToPolygon(circleCenterLatLng, radiusM, 64)
    const circleLocal = projectAll(projection, circleRing)

    const result = subtractNoSprayZones(boundaryLocal, [circleLocal])
    const sprayableArea = multiPolygonAreaM2(result, polygonAreaM2)

    const fullArea = 100 * 100
    const halfCircleArea = (Math.PI * radiusM * radiusM) / 2
    expect(sprayableArea).toBeCloseTo(fullArea - halfCircleArea, -1) // within ~a few m²
    expect(sprayableArea).toBeLessThan(fullArea)
  })
})
