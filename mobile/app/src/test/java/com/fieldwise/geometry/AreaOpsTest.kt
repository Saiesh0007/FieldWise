package com.fieldwise.geometry

import com.fieldwise.TestGeo
import com.fieldwise.TestGeo.area
import com.fieldwise.TestGeo.ll
import com.fieldwise.TestGeo.rect
import com.fieldwise.TestGeo.rectArea
import com.fieldwise.model.GeoArea
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AreaOpsTest {

    @Test
    fun areaIsMeasuredInMetresNotDegrees() {
        assertEquals(5000.0, AreaOps.areaSqm(rectArea(0.0, 0.0, 100.0, 50.0)), 1.0)
    }

    @Test
    fun unionAddsANeighbouringStrip() {
        val field = rectArea(0.0, 0.0, 100.0, 50.0)
        val merged = AreaOps.union(field, rect(100.0, 0.0, 110.0, 50.0))
        assertEquals(1, merged.polygons.size)
        assertEquals(5500.0, AreaOps.areaSqm(merged), 1.0)
    }

    @Test
    fun unionOfADisjointAreaKeepsBothParts() {
        val merged = AreaOps.union(rectArea(0.0, 0.0, 50.0, 50.0), rect(80.0, 0.0, 120.0, 50.0))
        assertEquals(2, merged.polygons.size)
        assertEquals(2500.0 + 2000.0, AreaOps.areaSqm(merged), 1.0)
    }

    @Test
    fun differenceRemovesAStripAndCanPunchAHole() {
        val field = rectArea(0.0, 0.0, 100.0, 50.0)
        val trimmed = AreaOps.difference(field, rect(90.0, 0.0, 100.0, 50.0))
        assertEquals(4500.0, AreaOps.areaSqm(trimmed), 1.0)

        val holed = AreaOps.difference(field, rect(40.0, 20.0, 60.0, 30.0))
        assertEquals(1, holed.polygons.size)
        assertEquals(1, holed.polygons[0].holes.size)
        assertEquals(5000.0 - 200.0, AreaOps.areaSqm(holed), 1.0)
    }

    @Test
    fun outputFollowsRfc7946Winding() {
        val holed = AreaOps.difference(rectArea(0.0, 0.0, 100.0, 50.0), rect(40.0, 20.0, 60.0, 30.0))
        val p = holed.polygons[0]
        val shell = p.shell.map { TestGeo.xy(it) }
        val hole = p.holes[0].map { TestGeo.xy(it) }
        fun signedArea(r: List<com.fieldwise.geo.XY>) =
            r.indices.sumOf { i -> val j = (i + 1) % r.size; r[i].x * r[j].y - r[j].x * r[i].y } / 2.0
        assertTrue("shell is counter-clockwise", signedArea(shell) > 0)
        assertTrue("holes are clockwise", signedArea(hole) < 0)
    }

    @Test
    fun containsUsesTheBoundaryAndInterior() {
        val field = rectArea(0.0, 0.0, 100.0, 50.0)
        assertTrue(AreaOps.contains(field, ll(50.0, 25.0)))
        assertFalse(AreaOps.contains(field, ll(150.0, 25.0)))
    }

    @Test
    fun aValidPolygonHasNoIssues() {
        assertTrue(AreaOps.validate(rectArea(0.0, 0.0, 100.0, 50.0)).isEmpty())
    }

    @Test
    fun aBowTieIsReportedWithItsLocation() {
        val bowTie = area(0.0 to 0.0, 100.0 to 100.0, 100.0 to 0.0, 0.0 to 100.0)
        val issues = AreaOps.validate(bowTie)
        assertEquals(1, issues.size)
        assertEquals(IssueKind.SELF_INTERSECTION, issues[0].kind)
        assertNotNull(issues[0].at)
        val local = TestGeo.xy(issues[0].at!!)
        assertEquals(50.0, local.x, 0.5)
        assertEquals(50.0, local.y, 0.5)
    }

    @Test
    fun emptyAndTinyAreasAreRejected() {
        assertEquals(IssueKind.EMPTY, AreaOps.validate(GeoArea.EMPTY)[0].kind)
        assertEquals(IssueKind.TOO_FEW_POINTS, AreaOps.validate(area(0.0 to 0.0, 10.0 to 0.0))[0].kind)
        assertEquals(IssueKind.TOO_SMALL, AreaOps.validate(rectArea(0.0, 0.0, 0.5, 0.5))[0].kind)
    }

    @Test
    fun cleanedDropsSlivers() {
        val withSliver = GeoArea(rectArea(0.0, 0.0, 100.0, 50.0).polygons + rect(200.0, 0.0, 200.3, 0.5))
        assertEquals(1, AreaOps.cleaned(withSliver).polygons.size)
    }
}
