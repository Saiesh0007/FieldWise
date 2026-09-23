package com.fieldwise.search

import com.fieldwise.model.LatLng
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoordinateParserTest {
    private fun assertPoint(text: String, lat: Double, lng: Double, tolerance: Double = 1e-6) {
        val parsed = CoordinateParser.parse(text)
        assertTrue("\"$text\" gave $parsed", parsed is CoordinateParse.Found)
        val p: LatLng = (parsed as CoordinateParse.Found).point
        assertEquals("$text latitude", lat, p.lat, tolerance)
        assertEquals("$text longitude", lng, p.lng, tolerance)
    }

    private fun assertNotCoordinates(text: String) =
        assertEquals("\"$text\"", CoordinateParse.NotCoordinates, CoordinateParser.parse(text))

    private fun assertInvalid(text: String): String {
        val parsed = CoordinateParser.parse(text)
        assertTrue("\"$text\" gave $parsed", parsed is CoordinateParse.Invalid)
        return (parsed as CoordinateParse.Invalid).message
    }

    @Test
    fun `decimal degrees in the usual forms`() {
        assertPoint("18.5204, 73.8567", 18.5204, 73.8567)
        assertPoint("18.5204 73.8567", 18.5204, 73.8567)
        assertPoint("  18.5204,73.8567  ", 18.5204, 73.8567)
        assertPoint("18.5204; 73.8567", 18.5204, 73.8567)
        assertPoint("18.5204° 73.8567°", 18.5204, 73.8567)
        assertPoint("-33.8688, 151.2093", -33.8688, 151.2093)
        assertPoint("−33.8688, 151.2093", -33.8688, 151.2093)
        assertPoint("0, 0", 0.0, 0.0)
    }

    @Test
    fun `hemisphere letters before or after the numbers`() {
        assertPoint("18.5204 N 73.8567 E", 18.5204, 73.8567)
        assertPoint("N18.5204 E73.8567", 18.5204, 73.8567)
        assertPoint("18.5204N, 73.8567E", 18.5204, 73.8567)
        assertPoint("18.5204 n, 73.8567 e", 18.5204, 73.8567)
        assertPoint("33.8688 S, 151.2093 E", -33.8688, 151.2093)
        assertPoint("40.7128 N 74.0060 W", 40.7128, -74.0060)
    }

    @Test
    fun `a leading east or west letter puts longitude first`() {
        assertPoint("E73.8567 N18.5204", 18.5204, 73.8567)
        assertPoint("73.8567E 18.5204N", 18.5204, 73.8567)
        assertPoint("74.0060 W, 40.7128 N", 40.7128, -74.0060)
    }

    @Test
    fun `degrees minutes and seconds`() {
        assertPoint("18°31'13.4\"N 73°51'24.1\"E", 18.0 + 31 / 60.0 + 13.4 / 3600.0, 73.0 + 51 / 60.0 + 24.1 / 3600.0)
        assertPoint("18 31 13.4 N 73 51 24.1 E", 18.0 + 31 / 60.0 + 13.4 / 3600.0, 73.0 + 51 / 60.0 + 24.1 / 3600.0)
        assertPoint("33°52'7.7\"S 151°12'33.5\"E", -(33.0 + 52 / 60.0 + 7.7 / 3600.0), 151.0 + 12 / 60.0 + 33.5 / 3600.0)
    }

    @Test
    fun `degrees and decimal minutes`() {
        assertPoint("18°31.224'N 73°51.402'E", 18.5204, 73.8567)
    }

    @Test
    fun `a first number that cannot be a latitude is taken as the longitude`() {
        assertPoint("151.2093, -33.8688", -33.8688, 151.2093)
        // Both could be latitudes, so the usual order, latitude then longitude, wins.
        assertPoint("73.8567, 18.5204", 73.8567, 18.5204)
    }

    @Test
    fun `coordinates inside Google Maps links`() {
        assertPoint("https://www.google.com/maps/@18.5204,73.8567,17z", 18.5204, 73.8567)
        assertPoint("https://www.google.com/maps?q=18.5204,73.8567", 18.5204, 73.8567)
        assertPoint("https://maps.google.com/?ll=18.5204,73.8567&z=15", 18.5204, 73.8567)
        assertPoint("https://www.google.com/maps/search/?api=1&query=18.5204%2C73.8567", 18.5204, 73.8567)
    }

    @Test
    fun `the exact place in a link beats the map centre`() {
        assertPoint(
            "https://www.google.com/maps/place/Field/@18.5,73.8,12z/data=!3m1!4b1!4m5!3m4!8m2!3d18.5204!4d73.8567",
            18.5204, 73.8567
        )
    }

    @Test
    fun `links that cannot be read offline say so`() {
        assertTrue(assertInvalid("https://maps.app.goo.gl/abc123XYZ").contains("Short links"))
        assertTrue(assertInvalid("https://example.com/somewhere").contains("no coordinates"))
    }

    @Test
    fun `impossible values are reported, not guessed at`() {
        assertTrue(assertInvalid("95, 200").contains("Latitude"))
        assertTrue(assertInvalid("18.5204, 200").contains("longitude"))
        assertTrue(assertInvalid("18 61 0 N 73 0 0 E").contains("60"))
        assertInvalid("https://www.google.com/maps/@95.0,73.8,17z")
    }

    @Test
    fun `place names are left for the place search`() {
        listOf(
            "Pune", "Khed Shivapur 412205", "12 MG Road", "north 18.52 east 73.85", "Pune, Maharashtra",
            "411001", "18.5204", "N 18.5204", "3 4 5", "", "   "
        ).forEach { assertNotCoordinates(it) }
    }

    @Test
    fun `mismatched hemisphere letters are not coordinates`() {
        assertNotCoordinates("18.5204 N 73.8567 S")
        assertNotCoordinates("18.5204 N 73.8567")
    }
}
