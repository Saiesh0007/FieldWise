package com.fieldwise.geo

import com.fieldwise.model.LatLng
import kotlin.math.cos
import kotlin.math.hypot

/** A point in a local planar frame, in metres east (x) and north (y) of the projection origin. */
data class XY(val x: Double, val y: Double)

/**
 * Local tangent-plane projection. All distances, areas and sweep spacings are computed here, never on raw degrees.
 * The metres-per-degree values are the standard WGS84 series at the origin latitude; over a field (a few km at most)
 * the distortion is far below GPS error.
 */
class LocalProjection(val originLat: Double, val originLng: Double) {
    private val metersPerDegLat: Double
    private val metersPerDegLng: Double

    init {
        val phi = Math.toRadians(originLat)
        metersPerDegLat = 111132.92 - 559.82 * cos(2 * phi) + 1.175 * cos(4 * phi) - 0.0023 * cos(6 * phi)
        metersPerDegLng = 111412.84 * cos(phi) - 93.5 * cos(3 * phi) + 0.118 * cos(5 * phi)
    }

    fun toLocal(p: LatLng): XY = XY((p.lng - originLng) * metersPerDegLng, (p.lat - originLat) * metersPerDegLat)

    fun toGeo(p: XY): LatLng = LatLng(originLat + p.y / metersPerDegLat, originLng + p.x / metersPerDegLng)

    companion object {
        /** Origin at the centre of the points' bounding box. */
        fun around(points: Iterable<LatLng>): LocalProjection {
            var south = Double.POSITIVE_INFINITY
            var north = Double.NEGATIVE_INFINITY
            var west = Double.POSITIVE_INFINITY
            var east = Double.NEGATIVE_INFINITY
            var any = false
            for (p in points) {
                any = true
                if (p.lat < south) south = p.lat
                if (p.lat > north) north = p.lat
                if (p.lng < west) west = p.lng
                if (p.lng > east) east = p.lng
            }
            return if (any) LocalProjection((south + north) / 2.0, (west + east) / 2.0) else LocalProjection(0.0, 0.0)
        }
    }
}

object GeoMath {
    /** Ground distance in metres between two nearby points. */
    fun distanceM(a: LatLng, b: LatLng): Double {
        val proj = LocalProjection((a.lat + b.lat) / 2.0, a.lng)
        val p = proj.toLocal(a)
        val q = proj.toLocal(b)
        return hypot(q.x - p.x, q.y - p.y)
    }

    /** Point [distanceM] metres from [origin] towards [bearingDeg] (0 = north, 90 = east). */
    fun offset(origin: LatLng, bearingDeg: Double, distanceM: Double): LatLng {
        val proj = LocalProjection(origin.lat, origin.lng)
        val b = Math.toRadians(bearingDeg)
        return proj.toGeo(XY(distanceM * kotlin.math.sin(b), distanceM * cos(b)))
    }
}
