import { describe, expect, it } from 'vitest'
import { buildFieldGeoJson } from './geojson'
import { buildFixtureScenario } from './testFixtures'

describe('buildFieldGeoJson', () => {
  it('produces a FeatureCollection with a boundary feature tagged role=boundary', () => {
    const { boundary, noSprayZones, sprayPlan, projection } = buildFixtureScenario()
    const fc = buildFieldGeoJson(boundary, noSprayZones, sprayPlan, projection)

    expect(fc.type).toBe('FeatureCollection')
    const boundaryFeatures = fc.features.filter((f) => f.properties?.role === 'boundary')
    expect(boundaryFeatures).toHaveLength(1)
    expect(boundaryFeatures[0].geometry.type).toBe('Polygon')
  })

  it('includes one no-spray-zone feature per zone', () => {
    const { boundary, noSprayZones, sprayPlan, projection } = buildFixtureScenario()
    const fc = buildFieldGeoJson(boundary, noSprayZones, sprayPlan, projection)
    const zoneFeatures = fc.features.filter((f) => f.properties?.role === 'no-spray-zone')
    expect(zoneFeatures).toHaveLength(noSprayZones.length)
  })

  it('splits spray plan legs into spray-leg and transit-leg roles matching the plan', () => {
    const { boundary, noSprayZones, sprayPlan, projection } = buildFixtureScenario()
    const fc = buildFieldGeoJson(boundary, noSprayZones, sprayPlan, projection)

    const totalLegs = sprayPlan.sorties.reduce((sum, s) => sum + s.passes.length, 0)
    const sprayLegCount = sprayPlan.sorties.reduce((sum, s) => sum + s.passes.filter((p) => p.spraying).length, 0)
    const transitLegCount = totalLegs - sprayLegCount

    expect(fc.features.filter((f) => f.properties?.role === 'spray-leg')).toHaveLength(sprayLegCount)
    expect(fc.features.filter((f) => f.properties?.role === 'transit-leg')).toHaveLength(transitLegCount)
  })

  it('omits plan legs entirely when no plan/projection is given', () => {
    const { boundary, noSprayZones } = buildFixtureScenario()
    const fc = buildFieldGeoJson(boundary, noSprayZones, null, null)
    expect(fc.features.some((f) => f.properties?.role === 'spray-leg' || f.properties?.role === 'transit-leg')).toBe(false)
  })

  it('round-trips cleanly through JSON.stringify/parse (what a real download does)', () => {
    const { boundary, noSprayZones, sprayPlan, projection } = buildFixtureScenario()
    const fc = buildFieldGeoJson(boundary, noSprayZones, sprayPlan, projection)
    const roundTripped = JSON.parse(JSON.stringify(fc))
    expect(roundTripped).toEqual(fc)
  })
})
