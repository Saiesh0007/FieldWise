/**
 * Mirrors the --color-provenance-* design tokens in src/index.css.
 * MapLibre paint expressions need raw hex — they can't read CSS custom
 * properties — so this is the second copy of those values. If you change
 * one, change both.
 */
export const PROVENANCE_COLORS = {
  satellite: '#d97706',
  walked: '#2563eb',
  confirmed: '#16a34a',
  accepted: '#7c3aed',
} as const
