import { describe, expect, it } from 'vitest'
import { cssHexToKmlColor } from './kmlColor'

describe('cssHexToKmlColor', () => {
  it('reverses RRGGBB to AABBGGRR', () => {
    // #16a34a -> r=16 g=a3 b=4a -> kml aa bb gg rr = ff 4a a3 16
    expect(cssHexToKmlColor('#16a34a')).toBe('ff4aa316')
  })

  it('accepts hex without the leading #', () => {
    expect(cssHexToKmlColor('d97706')).toBe(cssHexToKmlColor('#d97706'))
  })

  it('applies a custom alpha channel', () => {
    expect(cssHexToKmlColor('#ffffff', '80')).toBe('80ffffff')
  })

  it('throws on a malformed hex string', () => {
    expect(() => cssHexToKmlColor('#zzz')).toThrow()
    expect(() => cssHexToKmlColor('#fff')).toThrow()
  })
})
