import { describe, expect, it } from 'vitest'
import { coverageRateHaPerHour, passVolumeL, splitIntoSorties } from './droneProfile'
import type { DroneProfile, SprayPass } from './types'

const profile = (overrides: Partial<DroneProfile> = {}): DroneProfile => ({
  id: 'test',
  name: 'Test rig',
  swathM: 10,
  speedMps: 5,
  tankL: 10,
  applicationRateLPerHa: 15,
  altitudeM: 3,
  enduranceMin: 10,
  turnPenaltySec: 5,
  ...overrides,
})

describe('passVolumeL', () => {
  it('matches area * rate', () => {
    // 100m long, 10m swath = 1000 m² = 0.1 ha, at 15 L/ha = 1.5 L
    expect(passVolumeL(100, 10, 15)).toBeCloseTo(1.5, 6)
  })
})

describe('coverageRateHaPerHour', () => {
  it('computes swath-width * speed as a headline rate', () => {
    // 5 m/s * 3600s = 18000 m/hr, * 10m swath = 180,000 m² = 18 ha/hr
    expect(coverageRateHaPerHour(profile())).toBeCloseTo(18, 6)
  })
})

describe('splitIntoSorties', () => {
  it('does not split when everything fits in one tank', () => {
    const passes: SprayPass[] = [{ start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, spraying: true }]
    // 50m * 10m swath = 500 m² = 0.05 ha * 15 L/ha = 0.75 L — well under a 10L tank.
    const sorties = splitIntoSorties(passes, profile(), { x: 0, y: 0 })
    expect(sorties).toHaveLength(1)
    expect(sorties[0].volumeL).toBeCloseTo(0.75, 6)
  })

  it('splits a single long pass across multiple sorties when the tank runs out mid-pass', () => {
    // swath 10m, rate 100 L/ha, tank 5L => max affordable length per tank
    // = 5 * 10000 / (10 * 100) = 50m. A single 200m pass must therefore
    // split into exactly 4 sorties of 50m / 5L each.
    const testProfile = profile({ swathM: 10, applicationRateLPerHa: 100, tankL: 5 })
    const passes: SprayPass[] = [{ start: { x: 0, y: 5 }, end: { x: 200, y: 5 }, spraying: true }]
    const homePoint = { x: 0, y: 0 }

    const sorties = splitIntoSorties(passes, testProfile, homePoint)

    expect(sorties).toHaveLength(4)
    for (const sortie of sorties) {
      expect(sortie.volumeL).toBeLessThanOrEqual(testProfile.tankL + 1e-6)
      expect(sortie.volumeL).toBeCloseTo(5, 6)
    }

    // Every sortie starts and ends its transit legs at the refill point.
    for (const sortie of sorties) {
      const firstLeg = sortie.passes[0]
      const lastLeg = sortie.passes[sortie.passes.length - 1]
      expect(firstLeg.spraying === false || sortie.passes.length === 1).toBe(true)
      expect(lastLeg.spraying).toBe(false)
      expect(lastLeg.end).toEqual(homePoint)
    }

    // Total sprayed distance across all sorties reconstructs the full 200m pass.
    const totalSprayedM = sorties
      .flatMap((s) => s.passes)
      .filter((p) => p.spraying)
      .reduce((sum, p) => sum + Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y), 0)
    expect(totalSprayedM).toBeCloseTo(200, 6)

    // Total tank volume used reconstructs the full pass's volume (0.2ha * 100L/ha = 20L).
    const totalVolume = sorties.reduce((sum, s) => sum + s.volumeL, 0)
    expect(totalVolume).toBeCloseTo(20, 6)
  })

  it('throws on an invalid drone profile instead of looping forever', () => {
    const passes: SprayPass[] = [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, spraying: true }]
    expect(() => splitIntoSorties(passes, profile({ tankL: 0 }), { x: 0, y: 0 })).toThrow()
  })
})
