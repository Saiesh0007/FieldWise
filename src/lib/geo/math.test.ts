import { describe, expect, it } from 'vitest'
import { convexHull, distancePointToSegment, minTurnsHeadingRad, pointInPolygon, polygonAreaM2, scanlineSpans, simplifyPolyline } from './math'
import type { LocalPoint } from './types'

describe('polygonAreaM2', () => {
  it('computes the area of a simple square', () => {
    const square: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(polygonAreaM2(square)).toBeCloseTo(100, 6)
  })
})

describe('convexHull', () => {
  it('drops interior points and keeps the hull', () => {
    const points: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior — should be dropped
    ]
    const hull = convexHull(points)
    expect(hull).toHaveLength(4)
    expect(hull).not.toContainEqual({ x: 5, y: 5 })
  })
})

describe('minTurnsHeadingRad', () => {
  it('aligns with the long axis of a wide rectangle', () => {
    // 100m along x, 10m along y — sweeping along x (heading 0) crosses
    // only the 10m short dimension, minimizing pass count.
    const rect: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 10 },
      { x: 0, y: 10 },
    ]
    const heading = minTurnsHeadingRad(rect)
    expect(heading).toBeCloseTo(0, 3)
  })

  it('rotates with the field when the field is rotated', () => {
    // Same rectangle, rotated 90°: now 10m along x, 100m along y — the
    // long axis (and so the heading) should rotate with it.
    const rect: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: -10, y: 100 },
      { x: -10, y: 0 },
    ]
    const heading = minTurnsHeadingRad(rect)
    expect(Math.abs(heading - Math.PI / 2)).toBeLessThan(0.01)
  })
})

describe('scanlineSpans', () => {
  it('returns a single span for a convex shape', () => {
    const square: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const spans = scanlineSpans([square], 5)
    expect(spans).toEqual([[0, 10]])
  })

  it('returns two spans for a scanline crossing a concave notch', () => {
    // A "U" shape: 0..30 wide, 0..20 tall, with a notch cut out of the
    // middle from y=10 upward (x: 10..20). A scanline at y=15 should hit
    // the left leg and the right leg as two separate spans.
    const u: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]
    const spans = scanlineSpans([u], 15)
    expect(spans).toHaveLength(2)
    expect(spans[0]).toEqual([0, 10])
    expect(spans[1]).toEqual([20, 30])
  })

  it('excludes a hole ring (even-odd rule)', () => {
    const outer: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]
    const hole: LocalPoint[] = [
      { x: 8, y: 8 },
      { x: 12, y: 8 },
      { x: 12, y: 12 },
      { x: 8, y: 12 },
    ]
    const spans = scanlineSpans([outer, hole], 10)
    expect(spans).toEqual([
      [0, 8],
      [12, 20],
    ])
  })
})

describe('pointInPolygon', () => {
  const square: LocalPoint[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('is true for a point well inside the polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })

  it('is false for a point well outside the polygon', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
    expect(pointInPolygon({ x: 5, y: -5 }, square)).toBe(false)
  })

  it('is false for a point outside a concave notch even though it is within the bounding box', () => {
    // Same L-shape used in planner.test.ts: a 10x10 square with the top-right 6x6 corner removed.
    const lShape: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false) // inside the notch, outside the field
    expect(pointInPolygon({ x: 2, y: 2 }, lShape)).toBe(true) // inside the solid part
  })

  it('takes a single ring — hole exclusion is the caller\'s job (inside outer AND NOT inside hole)', () => {
    const hole: LocalPoint[] = [
      { x: 4, y: 4 },
      { x: 6, y: 4 },
      { x: 6, y: 6 },
      { x: 4, y: 6 },
    ]
    const centerOfHole = { x: 5, y: 5 }
    expect(pointInPolygon(centerOfHole, square)).toBe(true) // inside the outer ring
    expect(pointInPolygon(centerOfHole, hole)).toBe(true) // also inside the hole ring
    // A caller combining both (inside outer && !inside hole) correctly excludes it.
    expect(pointInPolygon(centerOfHole, square) && !pointInPolygon(centerOfHole, hole)).toBe(false)
  })
})

describe('distancePointToSegment', () => {
  it('is zero for a point on the segment', () => {
    expect(distancePointToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 9)
  })

  it('is the perpendicular distance for a point abeam the segment', () => {
    expect(distancePointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 9)
  })

  it('clamps to the nearest endpoint when the point is off the end of the segment', () => {
    // Beyond the (10,0) end, not abeam it — the closest point is the endpoint itself, not the infinite line.
    expect(distancePointToSegment({ x: 15, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(Math.hypot(5, 4), 9)
  })

  it('handles a degenerate zero-length segment as a point distance', () => {
    expect(distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 9)
  })
})

describe('simplifyPolyline', () => {
  it('returns the input unchanged for 2 or fewer points', () => {
    expect(simplifyPolyline([], 1)).toEqual([])
    expect(simplifyPolyline([{ x: 0, y: 0 }], 1)).toEqual([{ x: 0, y: 0 }])
    const twoPoints: LocalPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(simplifyPolyline(twoPoints, 1)).toEqual(twoPoints)
  })

  it('collapses a straight line with many collinear points down to just its two endpoints', () => {
    const points: LocalPoint[] = Array.from({ length: 20 }, (_, i) => ({ x: i * 0.5, y: 0 }))
    const result = simplifyPolyline(points, 0.5)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ x: 0, y: 0 })
    expect(result[result.length - 1]).toEqual({ x: 9.5, y: 0 })
  })

  it('drops small GPS-jitter-scale wobble within tolerance, keeping a near-straight walk as just its endpoints', () => {
    // A realistic "Web Serial GPS sampled every second over a ~15s walk"
    // shape: 16 points roughly along a line, each with a small (<1m)
    // perpendicular wobble — should collapse to a small handful of
    // points, never one edge per input point.
    const points: LocalPoint[] = Array.from({ length: 16 }, (_, i) => ({
      x: i * 1.4, // ~1.4 m/s walking pace, sampled once per second
      y: (i % 2 === 0 ? 1 : -1) * 0.3, // +/-0.3m jitter, well under GPS accuracy
    }))
    const result = simplifyPolyline(points, 1.5)
    expect(result.length).toBeLessThanOrEqual(5)
    expect(result[0]).toEqual(points[0])
    expect(result[result.length - 1]).toEqual(points[points.length - 1])
  })

  it('preserves a real corner beyond tolerance instead of cutting the shape', () => {
    // An L-shape: a genuine ~5m sideways turn partway along, well beyond a 0.5m tolerance.
    const points: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ]
    const result = simplifyPolyline(points, 0.5)
    expect(result).toContainEqual({ x: 5, y: 5 })
    expect(result.length).toBeGreaterThan(2)
  })

  it('always keeps the first and last point regardless of tolerance', () => {
    const points: LocalPoint[] = Array.from({ length: 30 }, (_, i) => ({ x: i, y: Math.sin(i) * 0.1 }))
    const result = simplifyPolyline(points, 1000) // absurdly large tolerance — collapses everything else
    expect(result).toEqual([points[0], points[points.length - 1]])
  })
})
