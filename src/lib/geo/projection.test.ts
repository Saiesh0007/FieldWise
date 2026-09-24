import { describe, expect, it } from 'vitest'
import { approximateCentroidLatLng, createLocalProjection } from './projection'
import type { LatLng } from './types'

describe('createLocalProjection', () => {
  it('maps the origin to (0, 0)', () => {
    const origin: LatLng = { lon: 77.5946, lat: 12.9716 } // Bengaluru
    const projection = createLocalProjection(origin)
    const local = projection.toLocal(origin)
    expect(local.x).toBeCloseTo(0, 6)
    expect(local.y).toBeCloseTo(0, 6)
  })

  it('round-trips lat/lng -> local -> lat/lng', () => {
    const origin: LatLng = { lon: 77.5946, lat: 12.9716 }
    const projection = createLocalProjection(origin)
    const point: LatLng = { lon: 77.596, lat: 12.973 }

    const roundTripped = projection.toLatLng(projection.toLocal(point))

    expect(roundTripped.lon).toBeCloseTo(point.lon, 9)
    expect(roundTripped.lat).toBeCloseTo(point.lat, 9)
  })

  it('gives approximately correct ground distance for a known offset', () => {
    // WGS84 meridian arc length is ~110,574m per degree of latitude at the
    // equator (not the commonly-quoted spherical-mean ~111,320m/° — that
    // figure is for a sphere, not the WGS84 ellipsoid); 0.001° should be ~110.57m.
    const origin: LatLng = { lon: 0, lat: 0 }
    const projection = createLocalProjection(origin)
    const north = projection.toLocal({ lon: 0, lat: 0.001 })
    expect(north.y).toBeCloseTo(110.57, 1)
    expect(north.x).toBeCloseTo(0, 6)
  })

  it('keeps longitude distance latitude-aware (not a flat degrees-to-meters scale)', () => {
    // At 60°N, 1° of longitude is roughly half the ground distance it is at the equator.
    const originEquator: LatLng = { lon: 0, lat: 0 }
    const eastAtEquator = createLocalProjection(originEquator).toLocal({ lon: 0.01, lat: 0 })

    const originHighLat: LatLng = { lon: 0, lat: 60 }
    const eastAtHighLat = createLocalProjection(originHighLat).toLocal({ lon: 0.01, lat: 60 })

    expect(Math.abs(eastAtHighLat.x)).toBeLessThan(Math.abs(eastAtEquator.x) * 0.6)
  })
})

describe('approximateCentroidLatLng', () => {
  it('averages a simple square', () => {
    const vertices: LatLng[] = [
      { lon: 0, lat: 0 },
      { lon: 2, lat: 0 },
      { lon: 2, lat: 2 },
      { lon: 0, lat: 2 },
    ]
    const centroid = approximateCentroidLatLng(vertices)
    expect(centroid.lon).toBeCloseTo(1, 9)
    expect(centroid.lat).toBeCloseTo(1, 9)
  })
})
