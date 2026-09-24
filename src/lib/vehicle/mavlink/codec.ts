/**
 * A minimal MAVLink v2 codec: encode a message to wire bytes, and
 * incrementally decode a stream of incoming bytes back into messages.
 * Deliberately hand-written against native Uint8Array/DataView (no
 * Node Buffer, no Node streams) so it runs in the browser with zero
 * polyfills — see messages.ts for where the per-message field layouts
 * and CRC constants came from.
 */
import { crc16X25 } from './crc'
import { MESSAGE_REGISTRY, type MessageDef } from './messages'

export type FieldType = 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'uint64' | 'int64' | 'float' | 'double'

const HEADER_LENGTH = 10 // STX, len, incompat, compat, seq, sysid, compid, msgid(3 bytes)
const CHECKSUM_LENGTH = 2
const STX = 0xfd
const SIGNED_FLAG = 0x01

function readField(view: DataView, offset: number, type: FieldType): number {
  switch (type) {
    case 'uint8':
      return view.getUint8(offset)
    case 'int8':
      return view.getInt8(offset)
    case 'uint16':
      return view.getUint16(offset, true)
    case 'int16':
      return view.getInt16(offset, true)
    case 'uint32':
      return view.getUint32(offset, true)
    case 'int32':
      return view.getInt32(offset, true)
    case 'uint64':
      return Number(view.getBigUint64(offset, true))
    case 'int64':
      return Number(view.getBigInt64(offset, true))
    case 'float':
      return view.getFloat32(offset, true)
    case 'double':
      return view.getFloat64(offset, true)
  }
}

function writeField(view: DataView, offset: number, type: FieldType, value: number): void {
  switch (type) {
    case 'uint8':
      view.setUint8(offset, value)
      break
    case 'int8':
      view.setInt8(offset, value)
      break
    case 'uint16':
      view.setUint16(offset, value, true)
      break
    case 'int16':
      view.setInt16(offset, value, true)
      break
    case 'uint32':
      view.setUint32(offset, value >>> 0, true)
      break
    case 'int32':
      view.setInt32(offset, value, true)
      break
    case 'uint64':
      view.setBigUint64(offset, BigInt(Math.trunc(value)), true)
      break
    case 'int64':
      view.setBigInt64(offset, BigInt(Math.trunc(value)), true)
      break
    case 'float':
      view.setFloat32(offset, value, true)
      break
    case 'double':
      view.setFloat64(offset, value, true)
      break
  }
}

export function encodeMessagePayload(def: MessageDef, values: Record<string, number>): Uint8Array {
  const buffer = new Uint8Array(def.payloadLength)
  const view = new DataView(buffer.buffer)
  for (const field of def.fields) {
    writeField(view, field.offset, field.type, values[field.name] ?? 0)
  }
  return buffer
}

/**
 * MAVLink v2 requires the payload to be right-truncated to the last
 * non-zero byte before sending (and, symmetrically, requires receivers
 * to treat a short payload as zero-padded — see decodeMessagePayload).
 */
function truncateTrailingZeros(payload: Uint8Array): Uint8Array {
  let len = payload.length
  while (len > 0 && payload[len - 1] === 0) len--
  return payload.subarray(0, len)
}

export function decodeMessagePayload(def: MessageDef, payload: Uint8Array): Record<string, number> {
  const padded = new Uint8Array(def.payloadLength)
  padded.set(payload.subarray(0, Math.min(payload.length, def.payloadLength)))
  const view = new DataView(padded.buffer)
  const result: Record<string, number> = {}
  for (const field of def.fields) {
    result[field.name] = readField(view, field.offset, field.type)
  }
  return result
}

export interface EncodeFrameOptions {
  sysid: number
  compid: number
  seq: number
}

/** Builds a complete, checksummed MAVLink v2 wire frame ready to write to the serial port. */
export function encodeFrame(def: MessageDef, values: Record<string, number>, opts: EncodeFrameOptions): Uint8Array {
  const payload = truncateTrailingZeros(encodeMessagePayload(def, values))

  const frame = new Uint8Array(HEADER_LENGTH + payload.length + CHECKSUM_LENGTH)
  frame[0] = STX
  frame[1] = payload.length
  frame[2] = 0 // incompat flags (no signing)
  frame[3] = 0 // compat flags
  frame[4] = opts.seq & 0xff
  frame[5] = opts.sysid & 0xff
  frame[6] = opts.compid & 0xff
  frame[7] = def.id & 0xff
  frame[8] = (def.id >> 8) & 0xff
  frame[9] = (def.id >> 16) & 0xff
  frame.set(payload, HEADER_LENGTH)

  const crc = crc16X25(frame.subarray(0, HEADER_LENGTH + payload.length), 1, 0, def.crcExtra)
  new DataView(frame.buffer).setUint16(HEADER_LENGTH + payload.length, crc, true)

  return frame
}

export interface DecodedFrame {
  sysid: number
  compid: number
  seq: number
  msgId: number
  def: MessageDef
  fields: Record<string, number>
}

/**
 * Accumulates raw serial bytes and yields complete, checksum-verified
 * MAVLink v2 frames as they arrive. Bytes that don't form a valid frame
 * (garbage, a partial frame at connect time, an unrecognized message, a
 * failed checksum) are silently resynced past — this mirrors how every
 * MAVLink implementation treats a byte stream that can start mid-frame.
 */
export class MavlinkFrameReader {
  private buffer: number[] = []

  push(bytes: Uint8Array): DecodedFrame[] {
    for (const b of bytes) this.buffer.push(b)

    const frames: DecodedFrame[] = []

    for (;;) {
      while (this.buffer.length > 0 && this.buffer[0] !== STX) this.buffer.shift()
      if (this.buffer.length < HEADER_LENGTH) break

      const payloadLength = this.buffer[1]
      const totalLength = HEADER_LENGTH + payloadLength + CHECKSUM_LENGTH
      if (this.buffer.length < totalLength) break

      // Peek without consuming yet: an STX byte can occur by coincidence
      // inside a real frame's payload (1/256 chance per byte). Until the
      // checksum verifies, this is only a *candidate* frame boundary —
      // trusting `totalLength` and splicing it out immediately would, on
      // a false positive, consume real bytes that belong to the actual
      // next frame and corrupt the stream. So on any failure below we
      // back off by exactly one byte (drop just this STX) and let the
      // outer loop resync from the next byte, rather than discarding the
      // whole tentative frame.
      const frameBytes = Uint8Array.from(this.buffer.slice(0, totalLength))

      const incompatFlags = frameBytes[2]
      if (incompatFlags & SIGNED_FLAG) {
        this.buffer.shift() // signed links unsupported — not confidently a real frame boundary either way
        continue
      }

      const msgId = frameBytes[7] | (frameBytes[8] << 8) | (frameBytes[9] << 16)
      const def = MESSAGE_REGISTRY[msgId] ?? null
      if (!def) {
        // Unregistered message id: we have no CRC_EXTRA to verify this
        // candidate with, so we can't tell a real-but-unparsed message
        // apart from a false-positive STX. Treat it as unconfirmed.
        this.buffer.shift()
        continue
      }

      const expectedCrc = crc16X25(frameBytes.subarray(0, totalLength - CHECKSUM_LENGTH), 1, 0, def.crcExtra)
      const actualCrc = new DataView(frameBytes.buffer).getUint16(totalLength - CHECKSUM_LENGTH, true)
      if (expectedCrc !== actualCrc) {
        this.buffer.shift()
        continue
      }

      // Checksum verified — this is confirmed to be a real frame, now it's safe to consume it whole.
      this.buffer.splice(0, totalLength)
      frames.push({
        sysid: frameBytes[5],
        compid: frameBytes[6],
        seq: frameBytes[4],
        msgId,
        def,
        fields: decodeMessagePayload(def, frameBytes.subarray(HEADER_LENGTH, HEADER_LENGTH + payloadLength)),
      })
    }

    return frames
  }
}
