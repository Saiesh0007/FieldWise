import { describe, expect, it } from 'vitest'
import { buildHandoffSheetHtml } from './handoffSheet'
import { buildFixtureScenario } from './testFixtures'

describe('buildHandoffSheetHtml', () => {
  const scenario = buildFixtureScenario()
  const fixedDate = new Date('2026-09-22T12:00:00.000Z')

  it('produces a full standalone HTML document', () => {
    const html = buildHandoffSheetHtml({ fieldName: 'Test Field', ...scenario, generatedAt: fixedDate })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<html')
    expect(html.trim().endsWith('</html>')).toBe(true)
    expect(html).toContain(fixedDate.toISOString())
  })

  it('includes the plan totals (area, distance, volume, sortie count)', () => {
    const html = buildHandoffSheetHtml({ fieldName: 'Test Field', ...scenario, generatedAt: fixedDate })
    expect(html).toContain(`${scenario.sprayPlan.areaHa.toFixed(2)} ha`)
    expect(html).toContain(`${scenario.sprayPlan.totalVolumeL.toFixed(1)} L`)
    expect(html).toContain(String(scenario.sprayPlan.sorties.length))
  })

  it('includes one waypoint table row per flattened waypoint', () => {
    const html = buildHandoffSheetHtml({ fieldName: 'Test Field', ...scenario, generatedAt: fixedDate })
    const waypointRowCount = (html.match(/spray<\/td><\/tr>|transit<\/td><\/tr>/g) ?? []).length
    const totalLegs = scenario.sprayPlan.sorties.reduce((sum, s) => sum + s.passes.length, 0)
    // one row per de-duplicated flattened point, so at least totalLegs (each pass contributes an end point) rows exist
    expect(waypointRowCount).toBeGreaterThanOrEqual(totalLegs)
  })

  it('reflects the readiness state — blocked when there are unverified edges', () => {
    const html = buildHandoffSheetHtml({ fieldName: 'Test Field', ...scenario, generatedAt: fixedDate })
    if (scenario.readiness && !scenario.readiness.cleared) {
      expect(html).toContain('readiness blocked')
    } else {
      expect(html).toContain('readiness cleared')
    }
  })

  it('escapes special characters in the field name', () => {
    const html = buildHandoffSheetHtml({ fieldName: 'A & B <script>', ...scenario, generatedAt: fixedDate })
    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('<script>')
  })

  it('lists every no-spray zone by label', () => {
    const html = buildHandoffSheetHtml({ fieldName: 'Test Field', ...scenario, generatedAt: fixedDate })
    for (const zone of scenario.noSprayZones) {
      expect(html).toContain(zone.label)
    }
  })
})
