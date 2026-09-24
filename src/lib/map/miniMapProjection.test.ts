import { describe, expect, it } from 'vitest'
import { fitLocalPointsToViewport } from './miniMapProjection'
import type { LocalPoint } from '@/lib/geo/types'

describe('fitLocalPointsToViewport', () => {
  it('maps a single point to the exact center of the viewport', () => {
    const project = fitLocalPointsToViewport([{ x: 42, y: -17 }], 200, 20)
    expect(project({ x: 42, y: -17 })).toEqual({ x: 100, y: 100 })
  })

  it('maps an empty point set to the center (degenerate case, still usable before any walk data exists)', () => {
    const project = fitLocalPointsToViewport([], 200, 20)
    expect(project({ x: 0, y: 0 })).toEqual({ x: 100, y: 100 })
  })

  it('flips Y — a point with a larger local y lands at a smaller viewport y (higher on screen)', () => {
    const points: LocalPoint[] = [{ x: 0, y: -10 }, { x: 0, y: 10 }]
    const project = fitLocalPointsToViewport(points, 200, 20)
    const top = project({ x: 0, y: 10 })
    const bottom = project({ x: 0, y: -10 })
    expect(top.y).toBeLessThan(bottom.y)
  })

  it('scales so the extreme points land exactly on the padded edge of the viewport', () => {
    const points: LocalPoint[] = [{ x: -50, y: 0 }, { x: 50, y: 0 }]
    const project = fitLocalPointsToViewport(points, 200, 20)
    expect(project({ x: -50, y: 0 }).x).toBeCloseTo(20, 6)
    expect(project({ x: 50, y: 0 }).x).toBeCloseTo(180, 6)
  })

  it('uses a uniform scale on both axes (picks the more constraining span), so shapes are not stretched', () => {
    // 100m wide, 20m tall — width is the binding constraint.
    const points: LocalPoint[] = [{ x: -50, y: -10 }, { x: 50, y: 10 }]
    const project = fitLocalPointsToViewport(points, 200, 0)
    const wide = project({ x: 50, y: 0 }).x - project({ x: -50, y: 0 }).x
    const tall = project({ x: 0, y: 10 }).y - project({ x: 0, y: -10 }).y
    // width spans the full 200px viewport (100m -> 200px => scale 2), height should use the SAME scale (20m -> 40px), not stretch to fill.
    expect(wide).toBeCloseTo(200, 6)
    expect(Math.abs(tall)).toBeCloseTo(40, 6)
  })

  it('handles a zero-span axis (all points share an x or y) without producing NaN/Infinity', () => {
    const points: LocalPoint[] = [{ x: 5, y: -5 }, { x: 5, y: 5 }]
    const project = fitLocalPointsToViewport(points, 200, 20)
    const result = project({ x: 5, y: 0 })
    expect(Number.isFinite(result.x)).toBe(true)
    expect(Number.isFinite(result.y)).toBe(true)
  })
})
