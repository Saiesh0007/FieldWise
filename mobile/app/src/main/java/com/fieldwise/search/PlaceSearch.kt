package com.fieldwise.search

import com.fieldwise.model.LatLng

/** A place the map can jump to. [zoom] is how close to look: a village needs less zoom than an exact coordinate. */
data class PlaceResult(val name: String, val point: LatLng, val zoom: Double)

sealed interface SearchOutcome {
    data class Found(val results: List<PlaceResult>) : SearchOutcome
    object NotFound : SearchOutcome

    /** The lookup itself failed, usually because there is no connection. [message] is ready to show. */
    data class Failed(val message: String) : SearchOutcome
}

/** Looks a place name up. Coordinates never come here: they are read on the phone by [CoordinateParser]. */
interface PlaceSearch {
    suspend fun search(query: String): SearchOutcome
}
