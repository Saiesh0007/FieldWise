import { describe, expect, it } from 'vitest'
import { parseNominatimResults } from './geocoding'

describe('parseNominatimResults', () => {
  it('parses a well-formed Nominatim response', () => {
    const raw = [
      {
        place_id: 12345,
        display_name: 'Moga, Punjab, India',
        lat: '30.35',
        lon: '75.75',
        boundingbox: ['30.30', '30.40', '75.70', '75.80'],
      },
    ]
    expect(parseNominatimResults(raw)).toEqual([
      { id: '12345', label: 'Moga, Punjab, India', lat: 30.35, lon: 75.75, boundingBox: [30.3, 30.4, 75.7, 75.8] },
    ])
  })

  it('parses multiple results, preserving order', () => {
    const raw = [
      { place_id: 1, display_name: 'A', lat: '1', lon: '2' },
      { place_id: 2, display_name: 'B', lat: '3', lon: '4' },
    ]
    const results = parseNominatimResults(raw)
    expect(results.map((r) => r.label)).toEqual(['A', 'B'])
  })

  it('returns an empty array for an empty result set', () => {
    expect(parseNominatimResults([])).toEqual([])
  })

  it('returns an empty array for non-array input (a malformed/unexpected service response)', () => {
    expect(parseNominatimResults(null)).toEqual([])
    expect(parseNominatimResults(undefined)).toEqual([])
    expect(parseNominatimResults({ error: 'nope' })).toEqual([])
    expect(parseNominatimResults('not json')).toEqual([])
  })

  it('skips individual malformed entries instead of failing the whole batch', () => {
    const raw = [
      { place_id: 1, display_name: 'Valid Place', lat: '10', lon: '20' },
      { place_id: 2, display_name: 'Missing lat/lon' }, // no lat/lon at all
      { place_id: 3, lat: '10', lon: '20' }, // no display_name
      { place_id: 4, display_name: 'Bad numbers', lat: 'not-a-number', lon: '20' },
      null,
      'a string, not an object',
      42,
    ]
    const results = parseNominatimResults(raw)
    expect(results).toHaveLength(1)
    expect(results[0].label).toBe('Valid Place')
  })

  it('handles a missing or malformed boundingbox by leaving boundingBox null, without dropping the result', () => {
    const raw = [
      { place_id: 1, display_name: 'No bbox', lat: '1', lon: '2' },
      { place_id: 2, display_name: 'Bad bbox', lat: '1', lon: '2', boundingbox: ['1', '2'] }, // wrong length
      { place_id: 3, display_name: 'Non-numeric bbox', lat: '1', lon: '2', boundingbox: ['a', 'b', 'c', 'd'] },
    ]
    const results = parseNominatimResults(raw)
    expect(results).toHaveLength(3)
    expect(results.every((r) => r.boundingBox === null)).toBe(true)
  })

  it('falls back to a lat,lon id when place_id is missing or not a primitive', () => {
    const raw = [{ display_name: 'No place_id', lat: '10', lon: '20' }]
    expect(parseNominatimResults(raw)[0].id).toBe('10,20')
  })
})
