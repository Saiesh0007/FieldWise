/**
 * KML colors are AABBGGRR hex (alpha, then blue/green/red reversed from
 * the usual CSS order) — the opposite byte order of the app's own
 * `#RRGGBB` design tokens (see lib/map/provenanceColors.ts). This
 * converts one to the other so KML exports can reuse the same color
 * values the map already renders, instead of a second hand-picked set
 * that could silently drift out of sync.
 */
export function cssHexToKmlColor(cssHex: string, alphaHex = 'ff'): string {
  const hex = cssHex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`cssHexToKmlColor: expected a #RRGGBB hex string, got "${cssHex}"`)
  }
  const r = hex.slice(0, 2)
  const g = hex.slice(2, 4)
  const b = hex.slice(4, 6)
  return `${alphaHex}${b}${g}${r}`.toLowerCase()
}
