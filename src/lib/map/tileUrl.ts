/**
 * Pure URL-template and placeholder-detection helpers for the resilient
 * satellite tile protocol (see resilientSatelliteTiles.ts). Kept
 * separate and dependency-free (no fetch, no Cache API, no MapLibre) so
 * this part of the logic — the part that can actually be wrong in a
 * subtle way — is unit-testable without a browser.
 */

/** Fills a {z}/{x}/{y} tile URL template. */
export function buildTileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** Parses this project's custom `fwsat://{z}/{x}/{y}` tile-request URL. Returns null for anything else (defensive — MapLibre should never ask for a malformed one, but the protocol handler shouldn't crash if it somehow does). */
export function parseTileRequestUrl(url: string): { z: number; x: number; y: number } | null {
  const match = url.match(/^fwsat:\/\/(\d+)\/(\d+)\/(\d+)$/)
  if (!match) return null
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) }
}

/**
 * The exact byte length of Esri World Imagery's static "Map data not yet
 * available" placeholder tile — confirmed byte-identical (same MD5)
 * across many sampled coordinates and zoom levels with no real imagery
 * coverage. An exact match is a strong signal (a real, distinct JPEG
 * compressing to this exact size is highly improbable); a small margin
 * around it catches the same placeholder served with trivially different
 * JPEG encoder metadata without false-positiving on genuinely small (but
 * real) tiles, which in samples of real imagery ran ~5.5KB+.
 */
export const ESRI_PLACEHOLDER_BYTE_LENGTH = 2521
const PLACEHOLDER_MARGIN_BYTES = 50

export function looksLikePlaceholderTile(byteLength: number): boolean {
  return Math.abs(byteLength - ESRI_PLACEHOLDER_BYTE_LENGTH) <= PLACEHOLDER_MARGIN_BYTES
}
