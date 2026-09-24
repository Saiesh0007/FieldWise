import { describe, expect, it } from 'vitest'
import { buildWaypointCsv, buildWaypointCsvRows } from './csv'
import { buildFixtureScenario } from './testFixtures'

describe('buildWaypointCsv', () => {
  const scenario = buildFixtureScenario()

  it('has the expected header row', () => {
    const csv = buildWaypointCsv(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    expect(csv.split('\n')[0]).toBe('seq,sortie,lat,lon,alt_m,spraying')
  })

  it('one data row per flattened waypoint, sequential seq starting at 0', () => {
    const rows = buildWaypointCsvRows(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((r, i) => expect(r.seq).toBe(i))
  })

  it('spraying flag matches the pass it came from — some spray rows and some transit rows exist for this fixture', () => {
    const rows = buildWaypointCsvRows(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    expect(rows.some((r) => r.spraying)).toBe(true)
    expect(rows.some((r) => !r.spraying)).toBe(true)
  })

  it('every row parses back to the correct column count and numeric fields', () => {
    const csv = buildWaypointCsv(scenario.sprayPlan, scenario.projection, scenario.droneProfile.altitudeM)
    const lines = csv.trim().split('\n')
    const dataLines = lines.slice(1)
    for (const line of dataLines) {
      const cols = line.split(',')
      expect(cols).toHaveLength(6)
      expect(Number.isNaN(Number(cols[0]))).toBe(false)
      expect(Number.isNaN(Number(cols[2]))).toBe(false)
      expect(Number.isNaN(Number(cols[3]))).toBe(false)
      expect(['true', 'false']).toContain(cols[5])
    }
  })
})
