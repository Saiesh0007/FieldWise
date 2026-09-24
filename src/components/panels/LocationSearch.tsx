import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { GeocodingError, searchPlaces, type GeocodeResult } from '@/lib/map/geocoding'

const SEARCH_DEBOUNCE_MS = 450
const MIN_QUERY_LENGTH = 3

export interface SelectedLocation {
  lat: number
  lon: number
  boundingBox: [number, number, number, number] | null
}

interface LocationSearchProps {
  onLocationSelected: (location: SelectedLocation) => void
}

const GEOLOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: "Location permission was denied. Allow location access in your browser's site settings to use this, or search for a place name instead.",
  2: "Your current position isn't available right now — try again, or search for a place name instead.",
  3: 'Getting your location took too long — try again, or search for a place name instead.',
}

/**
 * "Find my own field" — the search box + "Use my current location"
 * button that let a pilot navigate anywhere in the world before
 * tracing/walking a boundary, instead of only ever seeing the fixed
 * sample field. Purely a map-navigation aid: selecting a result or
 * using geolocation only recenters the map (via onLocationSelected,
 * wired up through App.tsx to FieldMap's flyTo prop) — it never touches
 * the boundary/session state itself, so every existing input flow
 * (trace, GPS-walk, file import, sample field) works completely
 * unchanged once the map is looking at the right place.
 */
export function LocationSearch({ onLocationSelected }: LocationSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setSearchError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setSearchError(null)
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const found = await searchPlaces(trimmed, controller.signal)
        setResults(found)
        setOpen(true)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setSearchError(err instanceof GeocodingError ? err.message : 'Search failed — try again in a moment.')
        setResults([])
        setOpen(true) // otherwise the error has nowhere to render — the dropdown container itself is gated on `open`
      } finally {
        setLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => () => abortRef.current?.abort(), []) // cancel any in-flight search on unmount

  const selectResult = (result: GeocodeResult) => {
    onLocationSelected({ lat: result.lat, lon: result.lon, boundingBox: result.boundingBox })
    setQuery(result.label)
    setOpen(false)
    setResults([])
  }

  const useCurrentLocation = () => {
    setLocationError(null)
    if (!('geolocation' in navigator)) {
      setLocationError('Geolocation is not available in this browser.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        onLocationSelected({ lat: position.coords.latitude, lon: position.coords.longitude, boundingBox: null })
        setQuery('')
        setOpen(false)
      },
      (err) => {
        setLocating(false)
        setLocationError(GEOLOCATION_ERROR_MESSAGES[err.code] ?? 'Could not get your current location.')
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">Find a location</h3>

      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLocationError(null)
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search for a place or address"
          className="w-full rounded-(--radius-control) border border-(--border-subtle) bg-(--surface-panel) px-2.5 py-1.5 text-sm transition-colors focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--text-muted)">
            <Spinner />
          </span>
        )}

        {open && (query.trim().length >= MIN_QUERY_LENGTH || searchError) && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-(--radius-card) border border-(--border-subtle) bg-(--surface-panel) shadow-(--shadow-panel)">
            {searchError ? (
              <p className="p-2.5 text-xs text-danger">{searchError}</p>
            ) : results.length === 0 ? (
              !loading && <p className="p-2.5 text-xs text-(--text-muted)">No places found for "{query.trim()}".</p>
            ) : (
              <ul className="max-h-52 overflow-y-auto">
                {results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => selectResult(result)}
                      className="block w-full px-2.5 py-2 text-left text-xs text-(--text-primary) transition-colors hover:bg-(--surface-panel-raised)"
                    >
                      {result.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Button size="sm" variant="secondary" disabled={locating} onClick={useCurrentLocation}>
        {locating && <Spinner />}
        {locating ? 'Getting location…' : 'Use my current location'}
      </Button>
      {locationError && <p className="text-xs text-danger">{locationError}</p>}
    </section>
  )
}
