package com.fieldwise.geo

import com.fieldwise.model.LatLng
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeoTest {

    @Test
    fun projectionRoundTrips() {
        val proj = LocalProjection(18.5204, 73.8567)
        val p = LatLng(18.5231, 73.8602)
        val back = proj.toGeo(proj.toLocal(p))
        assertEquals(p.lat, back.lat, 1e-9)
        assertEquals(p.lng, back.lng, 1e-9)
    }

    @Test
    fun degreesConvertToKnownMetreLengths() {
        // One degree of latitude is about 110.6 km near 18.5 N and about 111.1 km near 45 N.
        val north = LocalProjection(18.5, 73.0).toLocal(LatLng(19.5, 73.0))
        assertEquals(110_690.0, north.y, 150.0)
        // One degree of longitude at 45 N is about 78.8 km.
        val east = LocalProjection(45.0, 10.0).toLocal(LatLng(45.0, 11.0))
        assertEquals(78_850.0, east.x, 150.0)
    }

    @Test
    fun distanceMatchesPlanarMath() {
        val a = LatLng(18.5204, 73.8567)
        val b = GeoMath.offset(a, 90.0, 250.0)
        assertEquals(250.0, GeoMath.distanceM(a, b), 0.01)
        val c = GeoMath.offset(a, 0.0, 120.0)
        assertEquals(120.0, GeoMath.distanceM(a, c), 0.01)
    }

    // Ported from the GARUD prototype's PolygonUtilsTest.
    @Test
    fun shoelaceAreaOfSquare() {
        val square = listOf(XY(0.0, 0.0), XY(10.0, 0.0), XY(10.0, 10.0), XY(0.0, 10.0))
        assertEquals(100.0, PlaneMath.shoelaceArea(square), 1e-9)
    }

    @Test
    fun thinKeepsFirstAndLastAndDropsCloseNeighbours() {
        val pts = listOf(XY(0.0, 0.0), XY(0.5, 0.0), XY(1.0, 0.0), XY(3.0, 0.0), XY(5.0, 0.0))
        val thinned = PlaneMath.thin(pts, 1.5)
        assertEquals(XY(0.0, 0.0), thinned.first())
        assertEquals(XY(5.0, 0.0), thinned.last())
        assertTrue("0.5 and 1.0 are closer than 1.5 m to the first point", XY(0.5, 0.0) !in thinned && XY(1.0, 0.0) !in thinned)
    }

    @Test
    fun headingDifferenceWrapsAround() {
        assertEquals(20.0, PlaneMath.headingDiffDeg(350.0, 10.0), 1e-9)
        assertEquals(180.0, PlaneMath.headingDiffDeg(0.0, 180.0), 1e-9)
    }

    @Test
    fun longestEdgeAngleIsFoldedIntoHalfTurn() {
        val rect = listOf(XY(0.0, 0.0), XY(100.0, 0.0), XY(100.0, 50.0), XY(0.0, 50.0))
        assertEquals(0.0, PlaneMath.longestEdgeAngle(rect), 1e-9)
        val tall = listOf(XY(0.0, 0.0), XY(10.0, 0.0), XY(10.0, 80.0), XY(0.0, 80.0))
        assertEquals(90.0, PlaneMath.longestEdgeAngle(tall), 1e-9)
    }
}
