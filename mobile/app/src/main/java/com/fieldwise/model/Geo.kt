package com.fieldwise.model

data class LatLng(val lat: Double, val lng: Double)

data class LatLngBounds(val south: Double, val west: Double, val north: Double, val east: Double) {
    val center: LatLng get() = LatLng((south + north) / 2.0, (west + east) / 2.0)
}

/** Outer ring plus holes. Rings are open: the first point is not repeated at the end. */
data class GeoPolygon(val shell: List<LatLng>, val holes: List<List<LatLng>> = emptyList()) {
    val vertexCount: Int get() = shell.size + holes.sumOf { it.size }
    fun rings(): List<List<LatLng>> = listOf(shell) + holes
}

/** One or more polygons: a GeoJSON Polygon or MultiPolygon. */
data class GeoArea(val polygons: List<GeoPolygon>) {
    val isEmpty: Boolean get() = polygons.isEmpty()
    val vertexCount: Int get() = polygons.sumOf { it.vertexCount }

    fun allPoints(): List<LatLng> = polygons.flatMap { p -> p.rings().flatten() }

    companion object {
        val EMPTY = GeoArea(emptyList())
        fun of(polygon: GeoPolygon) = GeoArea(listOf(polygon))
    }
}

fun Iterable<LatLng>.boundsOrNull(): LatLngBounds? {
    var south = Double.POSITIVE_INFINITY
    var north = Double.NEGATIVE_INFINITY
    var west = Double.POSITIVE_INFINITY
    var east = Double.NEGATIVE_INFINITY
    var any = false
    for (p in this) {
        any = true
        if (p.lat < south) south = p.lat
        if (p.lat > north) north = p.lat
        if (p.lng < west) west = p.lng
        if (p.lng > east) east = p.lng
    }
    return if (any) LatLngBounds(south, west, north, east) else null
}

fun GeoArea.boundsOrNull(): LatLngBounds? = allPoints().boundsOrNull()
