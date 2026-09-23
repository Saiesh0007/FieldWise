import { describe, expect, it } from 'vitest'
import type { SprayPass } from '@/lib/geo/types'
import { buildFlightPath, poseAtDistance, totalFlightPathLengthM } from './flightPreview'

const passes: SprayPass[] = [
  { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, spraying: true }, // due east
  { start: { x: 100, y: 0 }, end: { x: 100, y: 50 }, spraying: false }, // due north
]

describe('buildFlightPath / totalFlightPathLengthM', () => {
  it('flattens passes into a cumulative-distance vertex list', () => {
    const path = buildFlightPath(passes)
    expect(path.map((p) => p.distFromStartM)).toEqual([0, 100, 150])
    expect(totalFlightPathLengthM(path)).toBe(150)
  })

  it('returns an empty path (and zero length) for no passes', () => {
    expect(buildFlightPath([])).toEqual([])
    expect(totalFlightPathLengthM(buildFlightPath([]))).toBe(0)
  })
})

describe('poseAtDistance', () => {
  const path = buildFlightPath(passes)

  it('returns the start point, facing east, at distance 0', () => {
    const pose = poseAtDistance(path, 0)
    expect(pose?.point).toEqual({ x: 0, y: 0 })
    expect(pose?.headingDeg).toBeCloseTo(90, 5) // east = compass 90
  })

  it('interpolates partway along the first leg', () => {
    const pose = poseAtDistance(path, 50)
    expect(pose?.point).toEqual({ x: 50, y: 0 })
    expect(pose?.headingDeg).toBeCloseTo(90, 5)
  })

  it('picks up the second leg\'s heading once past the first leg\'s end', () => {
    const pose = poseAtDistance(path, 125)
    expect(pose?.point).toEqual({ x: 100, y: 25 })
    expect(pose?.headingDeg).toBeCloseTo(0, 5) // north = compass 0
  })

  it('clamps to the path end beyond its total length', () => {
    const pose = poseAtDistance(path, 9999)
    expect(pose?.point).toEqual({ x: 100, y: 50 })
  })

  it('clamps to the path start for a negative distance', () => {
    const pose = poseAtDistance(path, -50)
    expect(pose?.point).toEqual({ x: 0, y: 0 })
  })

  it('returns null for an empty path', () => {
    expect(poseAtDistance([], 10)).toBeNull()
  })
})
