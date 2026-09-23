import { describe, expect, it } from 'vitest'
import { DEFAULT_DRONE_PROFILE } from '@/lib/geo/defaults'
import type { FieldBoundary } from '@/lib/geo/types'
import {
  createProjectRecord,
  describeProjectSnapshot,
  DEFAULT_PROJECT_NAME,
  renameProjectRecord,
  sortProjectsByRecency,
  touchProjectRecord,
  uniqueProjectName,
  type ProjectSnapshot,
} from './project'

const EMPTY_SNAPSHOT: ProjectSnapshot = {
  boundary: null,
  noSprayZones: [],
  droneProfile: DEFAULT_DRONE_PROFILE,
  sweepStrategy: { kind: 'min-turns' },
}

const FAKE_BOUNDARY: FieldBoundary = {
  id: 'b1',
  vertices: [
    { lon: 0, lat: 0 },
    { lon: 1, lat: 0 },
    { lon: 1, lat: 1 },
    { lon: 0, lat: 1 },
  ],
  edges: [],
  source: 'satellite-trace',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('createProjectRecord', () => {
  it('defaults to DEFAULT_PROJECT_NAME and stamps createdAt/updatedAt identically', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    const record = createProjectRecord(EMPTY_SNAPSHOT, undefined, now)
    expect(record.name).toBe(DEFAULT_PROJECT_NAME)
    expect(record.createdAt).toBe(now.toISOString())
    expect(record.updatedAt).toBe(now.toISOString())
    expect(record.snapshot).toBe(EMPTY_SNAPSHOT)
  })

  it('accepts a custom name', () => {
    const record = createProjectRecord(EMPTY_SNAPSHOT, 'North 40')
    expect(record.name).toBe('North 40')
  })

  it('generates distinct ids for each record', () => {
    const a = createProjectRecord(EMPTY_SNAPSHOT)
    const b = createProjectRecord(EMPTY_SNAPSHOT)
    expect(a.id).not.toBe(b.id)
  })
})

describe('touchProjectRecord', () => {
  it('replaces the snapshot and bumps updatedAt, leaving id/name/createdAt untouched', () => {
    const created = createProjectRecord(EMPTY_SNAPSHOT, 'My Field', new Date('2026-01-01T00:00:00.000Z'))
    const newSnapshot: ProjectSnapshot = { ...EMPTY_SNAPSHOT, boundary: FAKE_BOUNDARY }
    const touched = touchProjectRecord(created, newSnapshot, new Date('2026-01-02T00:00:00.000Z'))

    expect(touched.id).toBe(created.id)
    expect(touched.name).toBe('My Field')
    expect(touched.createdAt).toBe(created.createdAt)
    expect(touched.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(touched.snapshot).toBe(newSnapshot)
  })
})

describe('renameProjectRecord', () => {
  it('renames and bumps updatedAt', () => {
    const record = createProjectRecord(EMPTY_SNAPSHOT, 'Old Name', new Date('2026-01-01T00:00:00.000Z'))
    const renamed = renameProjectRecord(record, 'New Name', new Date('2026-01-02T00:00:00.000Z'))
    expect(renamed.name).toBe('New Name')
    expect(renamed.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('trims whitespace', () => {
    const record = createProjectRecord(EMPTY_SNAPSHOT, 'Old')
    expect(renameProjectRecord(record, '  Padded Name  ').name).toBe('Padded Name')
  })

  it('keeps the old name rather than accepting an empty/whitespace-only new name', () => {
    const record = createProjectRecord(EMPTY_SNAPSHOT, 'Keep Me')
    expect(renameProjectRecord(record, '   ').name).toBe('Keep Me')
    expect(renameProjectRecord(record, '').name).toBe('Keep Me')
  })
})

describe('sortProjectsByRecency', () => {
  it('orders most-recently-updated first', () => {
    const older = createProjectRecord(EMPTY_SNAPSHOT, 'Older', new Date('2026-01-01T00:00:00.000Z'))
    const newer = createProjectRecord(EMPTY_SNAPSHOT, 'Newer', new Date('2026-01-03T00:00:00.000Z'))
    const middle = createProjectRecord(EMPTY_SNAPSHOT, 'Middle', new Date('2026-01-02T00:00:00.000Z'))

    const sorted = sortProjectsByRecency([older, newer, middle])
    expect(sorted.map((r) => r.name)).toEqual(['Newer', 'Middle', 'Older'])
  })

  it('does not mutate the input array', () => {
    const a = createProjectRecord(EMPTY_SNAPSHOT, 'A', new Date('2026-01-01T00:00:00.000Z'))
    const b = createProjectRecord(EMPTY_SNAPSHOT, 'B', new Date('2026-01-02T00:00:00.000Z'))
    const input = [a, b]
    sortProjectsByRecency(input)
    expect(input).toEqual([a, b])
  })
})

describe('uniqueProjectName', () => {
  it('returns the base name unchanged when nothing else uses it', () => {
    expect(uniqueProjectName('Untitled Project', [])).toBe('Untitled Project')
    expect(uniqueProjectName('Untitled Project', ['North 40'])).toBe('Untitled Project')
  })

  it('appends " 2" when the base name is already taken', () => {
    expect(uniqueProjectName('Untitled Project', ['Untitled Project'])).toBe('Untitled Project 2')
  })

  it('finds the next free number when several are already taken', () => {
    expect(uniqueProjectName('Untitled Project', ['Untitled Project', 'Untitled Project 2', 'Untitled Project 3'])).toBe(
      'Untitled Project 4',
    )
  })

  it('fills a gap left by a renamed/deleted project rather than always incrementing past it', () => {
    expect(uniqueProjectName('Untitled Project', ['Untitled Project', 'Untitled Project 3'])).toBe('Untitled Project 2')
  })
})

describe('describeProjectSnapshot', () => {
  it('reports "No field yet" for an empty snapshot', () => {
    expect(describeProjectSnapshot(EMPTY_SNAPSHOT)).toBe('No field yet')
  })

  it('reports the vertex count when a boundary exists', () => {
    expect(describeProjectSnapshot({ ...EMPTY_SNAPSHOT, boundary: FAKE_BOUNDARY })).toBe('4-vertex boundary')
  })
})
