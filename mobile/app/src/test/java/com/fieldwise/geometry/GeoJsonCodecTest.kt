package com.fieldwise.geometry

import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GeoJsonCodecTest {
    private val square = listOf(LatLng(18.0, 73.0), LatLng(18.0, 73.001), LatLng(18.001, 73.001), LatLng(18.001, 73.0))

    private fun points(ring: JSONArray) = (0 until ring.length()).map { GeoJsonCodec.latLng(ring.getJSONArray(it)) }

    /** Positive for counter-clockwise, as GeoJSON reads longitude as x and latitude as y. */
    private fun signedArea(ring: JSONArray): Double {
        val p = points(ring)
        return (0 until p.size - 1).sumOf { p[it].lng * p[it + 1].lat - p[it + 1].lng * p[it].lat } / 2.0
    }

    @Test
    fun `an exterior ring is closed and counter-clockwise whichever way it was drawn`() {
        listOf(square, square.reversed()).forEach { corners ->
            val ring = GeoJsonCodec.polygonCoordinates(GeoPolygon(corners)).getJSONArray(0)
            assertEquals(5, ring.length())
            assertEquals(points(ring).first(), points(ring).last())
            assertTrue(signedArea(ring) > 0.0)
        }
    }

    @Test
    fun `holes are clockwise`() {
        val hole = listOf(LatLng(18.0003, 73.0003), LatLng(18.0003, 73.0006), LatLng(18.0006, 73.0006), LatLng(18.0006, 73.0003))
        val coordinates = GeoJsonCodec.polygonCoordinates(GeoPolygon(square, listOf(hole)))
        assertEquals(2, coordinates.length())
        assertTrue(signedArea(coordinates.getJSONArray(0)) > 0.0)
        assertTrue(signedArea(coordinates.getJSONArray(1)) < 0.0)
    }

    @Test
    fun `a polygon survives a write and a read`() {
        val read = GeoJsonCodec.polygonFromCoordinates(GeoJsonCodec.polygonCoordinates(GeoPolygon(square)))!!
        assertEquals(4, read.shell.size)
        assertEquals(square.toSet(), read.shell.toSet())
    }

    @Test
    fun `more than one polygon becomes a MultiPolygon`() {
        val other = GeoPolygon(square.map { LatLng(it.lat + 1.0, it.lng) })
        val geometry = GeoJsonCodec.geometry(GeoArea(listOf(GeoPolygon(square), other)))!!
        assertEquals("MultiPolygon", geometry.getString("type"))
        assertEquals(2, geometry.getJSONArray("coordinates").length())
        assertEquals("Polygon", GeoJsonCodec.geometry(GeoArea.of(GeoPolygon(square)))!!.getString("type"))
        assertNull(GeoJsonCodec.geometry(GeoArea.EMPTY))
    }

    @Test
    fun `export precision is centimetres`() {
        val position = GeoJsonCodec.position(LatLng(18.123456789012, 73.987654321098), GeoJsonCodec.EXPORT_DIGITS)
        assertEquals(73.9876543, position.getDouble(0), 0.0)
        assertEquals(18.1234568, position.getDouble(1), 0.0)
    }

    @Test
    fun `line strings can carry an altitude`() {
        val line = GeoJsonCodec.lineString(listOf(LatLng(18.0, 73.0), LatLng(18.1, 73.1)), altitude = 3.0)
        assertEquals("LineString", line.getString("type"))
        assertEquals(3, line.getJSONArray("coordinates").getJSONArray(0).length())
        assertEquals(3.0, line.getJSONArray("coordinates").getJSONArray(1).getDouble(2), 0.0)
    }

    @Test
    fun `malformed polygons are refused rather than guessed at`() {
        assertNull(GeoJsonCodec.polygonFromCoordinates(JSONArray()))
        assertNull(GeoJsonCodec.polygonFromCoordinates(JSONArray("[[[73.0,18.0],[73.1,18.1]]]")))
        assertNull(GeoJsonCodec.polygonFromCoordinates(JSONArray("[[\"x\"]]")))
        assertNotNull(GeoJsonCodec.polygonFromCoordinates(JSONArray("[[[73.0,18.0],[73.1,18.0],[73.1,18.1],[73.0,18.0]]]")))
    }
}
