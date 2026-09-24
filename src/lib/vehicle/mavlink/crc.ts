/**
 * MAVLink's CRC-16/MCRF4XX ("X.25") checksum. This exact algorithm —
 * including the byte order of operations — is transcribed from the
 * reference implementation in the MAVLink code generator
 * (mavlink-mappings-gen's generator/utils.ts, itself a port of the
 * canonical C `crc_accumulate` in every official MAVLink library), not
 * recalled from memory: getting a single operation wrong here would
 * silently break every checksum and make the autopilot reject (or
 * simply never acknowledge) every message, which is exactly the kind of
 * failure this project can't afford to guess at.
 *
 * Verified in crc.test.ts by cross-checking against that same reference
 * implementation for random inputs — see the test for how to re-verify
 * this independently.
 */
const CRC_INITIAL = 0xffff;

function crcAccumulate(byte: number, crc: number): number {
  let tmp = (byte ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

/**
 * @param bytes the buffer to checksum
 * @param start first byte index to include (MAVLink v2: 1, skipping the STX magic byte)
 * @param trim number of trailing bytes to exclude (MAVLink v2: 2, the checksum placeholder itself)
 * @param crcExtra the message's CRC_EXTRA constant, folded in as one more accumulated byte at the end
 */
export function crc16X25(bytes: Uint8Array, start: number, trim: number, crcExtra: number): number {
  let crc = CRC_INITIAL;
  for (let i = start; i < bytes.length - trim; i++) {
    crc = crcAccumulate(bytes[i], crc);
  }
  crc = crcAccumulate(crcExtra, crc);
  return crc;
}
