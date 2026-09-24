import { describe, expect, it } from 'vitest'
import { polygonAreaM2 } from './math'
import { multiPolygonAreaM2, subtractNoSprayZones } from './noSprayZones'
import type { LocalPoint } from './types'

const square = (x0: number, y0: number, x1: number, y1: number): LocalPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

describe('subtractNoSprayZones', () => {
  it('returns the boundary unchanged when there are no zones', () => {
    const boundary = square(0, 0, 20, 20)
    const result = subtractNoSprayZones(boundary, [])
    expect(result).toHaveLength(1)
    expect(multiPolygonAreaM2(result, polygonAreaM2)).toBeCloseTo(400, 6)
  })

  it('punches a hole for a zone entirely inside the field', () => {
    const boundary = square(0, 0, 20, 20)
    const zone = square(8, 8, 12, 12) // 4x4 = 16 m², fully interior
    const result = subtractNoSprayZones(boundary, [zone])

    expect(result).toHaveLength(1) // still one polygon, just with a hole
    expect(result[0].length).toBe(2) // outer ring + one hole ring
    expect(multiPolygonAreaM2(result, polygonAreaM2)).toBeCloseTo(400 - 16, 6)
  })

  it('splits the field into two disjoint polygons when a zone cuts all the way through', () => {
    const boundary = square(0, 0, 20, 20)
    const zone = square(8, -1, 12, 21) // full-height strip through the middle
    const result = subtractNoSprayZones(boundary, [zone])

    expect(result).toHaveLength(2) // left piece + right piece
    const totalArea = multiPolygonAreaM2(result, polygonAreaM2)
    expect(totalArea).toBeCloseTo(400 - 4 * 20, 6) // zone's removed area clipped to the field's 20m height
  })
})
