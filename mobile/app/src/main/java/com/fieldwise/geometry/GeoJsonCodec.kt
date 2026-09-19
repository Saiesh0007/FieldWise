package com.fieldwise.geometry

import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * GeoJSON (RFC 7946) reading and writing for the geometry model. Positions are [longitude, latitude].
 * Written rings are closed, with exterior rings counter-clockwise and holes clockwise, as the RFC requires.
 */
object GeoJsonCodec {
    /** Seven decimal places is about 1 cm, far finer than any phone GPS. */
    const val EXPORT_DIGITS = 7

    private fun rounded(v: Double, digits: Int?): Double {
        if (digits == null) return v
        val factor = Math.pow(10.0, digits.toDouble())
        return Math.round(v * factor) / factor
    }

    fun position(p: LatLng, digits: Int? = null, altitude: Double? = null): JSONArray {
        val out = JSONArray().put(rounded(p.lng, digits)).put(rounded(p.lat, digits))
        if (altitude != null) out.put(altitude)
        return out
    }

    fun latLng(position: JSONArray): LatLng = LatLng(position.getDouble(1), position.getDouble(0))

    private fun open(points: List<LatLng>): List<LatLng> =
        if (points.size > 1 && points.first() == points.last()) points.dropLast(1) else points

    /** Positive when the ring runs counter-clockwise (x = longitude, y = latitude), measured from the first point. */
    private fun signedArea(points: List<LatLng>): Double {
        val origin = points.first()
        var sum = 0.0
        for (i in points.indices) {
            val a = points[i]
            val b = points[(i + 1) % points.size]
            sum += (a.lng - origin.lng) * (b.lat - origin.lat) - (b.lng - origin.lng) * (a.lat - origin.lat)
        }
        return sum / 2.0
    }

    private fun ring(points: List<LatLng>, counterClockwise: Boolean, digits: Int?): JSONArray {
        val pts = open(points)
        val ordered = if ((signedArea(pts) > 0.0) == counterClockwise) pts else pts.reversed()
        val out = JSONArray()
        ordered.forEach { out.put(position(it, digits)) }
        out.put(position(ordered.first(), digits))
        return out
    }

    /** The "coordinates" member of a GeoJSON Polygon. */
    fun polygonCoordinates(polygon: GeoPolygon, digits: Int? = null): JSONArray {
        val out = JSONArray()
        out.put(ring(polygon.shell, counterClockwise = true, digits = digits))
        polygon.holes.forEach { out.put(ring(it, counterClockwise = false, digits = digits)) }
        return out
    }

    /** A Polygon or MultiPolygon geometry object, or null for an empty area. */
    fun geometry(area: GeoArea, digits: Int? = null): JSONObject? = when (area.polygons.size) {
        0 -> null
        1 -> JSONObject().put("type", "Polygon").put("coordinates", polygonCoordinates(area.polygons[0], digits))
        else -> JSONObject().put("type", "MultiPolygon").put(
            "coordinates",
            JSONArray().also { multi -> area.polygons.forEach { multi.put(polygonCoordinates(it, digits)) } }
        )
    }

    fun lineString(points: List<LatLng>, digits: Int? = null, altitude: Double? = null): JSONObject =
        JSONObject().put("type", "LineString").put(
            "coordinates",
            JSONArray().also { line -> points.forEach { line.put(position(it, digits, altitude)) } }
        )

    /** Reads Polygon coordinates. Returns null when a ring has fewer than three distinct corners or is malformed. */
    fun polygonFromCoordinates(coordinates: JSONArray): GeoPolygon? = try {
        val rings = (0 until coordinates.length()).map { i ->
            val raw = coordinates.getJSONArray(i)
            open((0 until raw.length()).map { j -> latLng(raw.getJSONArray(j)) })
        }
        if (rings.isEmpty() || rings.any { it.size < 3 }) null else GeoPolygon(rings.first(), rings.drop(1))
    } catch (e: JSONException) {
        null
    }
}
