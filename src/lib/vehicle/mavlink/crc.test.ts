import { describe, expect, it } from 'vitest'
import { crc16X25 } from './crc'

/**
 * A second, independently-written transcription of the same reference
 * algorithm (mavlink-mappings-gen's generator/utils.ts x25crc, read
 * directly from node_modules during development — see crc.ts's comment),
 * used here purely to cross-check crc16X25 against an independent
 * reading of the source rather than testing the function against itself.
 * This is not a substitute for testing against a real Pixhawk, which
 * remains unverified — see the vehicle-connection checklist.
 */
function referenceX25Crc(buffer: Uint8Array, start: number, trim: number, magic: number): number {
  let crc = 0xffff
  const digest = (byte: number) => {
    let tmp = (byte & 0xff) ^ (crc & 0xff)
    tmp ^= tmp << 4
    tmp &= 0xff
    crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)
    crc &= 0xffff
  }
  for (let i = start; i < buffer.length - trim; i++) digest(buffer[i])
  digest(magic)
  return crc
}

function randomBytes(n: number, seed: number): Uint8Array {
  // Small deterministic PRNG (mulberry32) so failures are reproducible.
  let s = seed
  const next = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Uint8Array.from({ length: n }, () => Math.floor(next() * 256))
}

describe('crc16X25', () => {
  it('matches the reference implementation for a range of random buffers and CRC_EXTRA values', () => {
    for (let trial = 0; trial < 50; trial++) {
      const bytes = randomBytes(5 + (trial % 40), trial * 7919)
      const crcExtra = trial % 256
      expect(crc16X25(bytes, 1, 2, crcExtra)).toBe(referenceX25Crc(bytes, 1, 2, crcExtra))
    }
  })

  it('matches the reference implementation for edge-case buffer lengths', () => {
    for (const len of [3, 4, 5, 255]) {
      const bytes = randomBytes(len, len * 101)
      expect(crc16X25(bytes, 1, 2, 50)).toBe(referenceX25Crc(bytes, 1, 2, 50))
    }
  })

  it('is deterministic and sensitive to every byte (no trivial collisions in a small sample)', () => {
    const base = randomBytes(20, 42)
    const baseCrc = crc16X25(base, 1, 2, 50)
    for (let i = 1; i < base.length - 2; i++) {
      const mutated = base.slice()
      mutated[i] = (mutated[i] + 1) % 256
      expect(crc16X25(mutated, 1, 2, 50)).not.toBe(baseCrc)
    }
  })
})
