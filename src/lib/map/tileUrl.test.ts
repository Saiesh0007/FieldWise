import { describe, expect, it } from 'vitest'
import { buildTileUrl, looksLikePlaceholderTile, parseTileRequestUrl } from './tileUrl'

describe('buildTileUrl', () => {
  it('substitutes z/x/y into a template', () => {
    expect(buildTileUrl('https://example.com/{z}/{y}/{x}', 18, 186231, 107859)).toBe('https://example.com/18/107859/186231')
  })

  it('substitutes correctly even when x and y share digits (no accidental cross-substitution)', () => {
    expect(buildTileUrl('https://example.com/{z}/{x}/{y}.png', 5, 12, 12)).toBe('https://example.com/5/12/12.png')
  })
})

describe('parseTileRequestUrl', () => {
  it('parses a well-formed fwsat:// tile URL', () => {
    expect(parseTileRequestUrl('fwsat://18/186231/107859')).toEqual({ z: 18, x: 186231, y: 107859 })
  })

  it('returns null for a malformed or foreign URL', () => {
    expect(parseTileRequestUrl('https://example.com/18/186231/107859')).toBeNull()
    expect(parseTileRequestUrl('fwsat://not/a/tile')).toBeNull()
    expect(parseTileRequestUrl('fwsat://18/186231')).toBeNull()
    expect(parseTileRequestUrl('')).toBeNull()
  })
})

describe('looksLikePlaceholderTile', () => {
  it('matches the known exact placeholder byte length', () => {
    expect(looksLikePlaceholderTile(2521)).toBe(true)
  })

  it('matches within a small margin of the known length', () => {
    expect(looksLikePlaceholderTile(2521 + 40)).toBe(true)
    expect(looksLikePlaceholderTile(2521 - 40)).toBe(true)
  })

  it('does not match a real tile-sized response', () => {
    expect(looksLikePlaceholderTile(5547)).toBe(false) // a real sampled farmland tile from this project's own verification
    expect(looksLikePlaceholderTile(8000)).toBe(false)
  })

  it('does not match something far below the placeholder size either (e.g. a truncated/empty response)', () => {
    expect(looksLikePlaceholderTile(0)).toBe(false)
    expect(looksLikePlaceholderTile(100)).toBe(false)
  })
})
