package com.fieldwise.planner

import com.fieldwise.TestGeo
import com.fieldwise.TestGeo.area
import com.fieldwise.TestGeo.rect
import com.fieldwise.TestGeo.rectArea
import com.fieldwise.TestGeo.zone
import com.fieldwise.geo.XY
import com.fieldwise.geometry.Jts
import com.fieldwise.model.GeoArea
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.operation.union.UnaryUnionOp
import kotlin.math.cos
import kotlin.math.sin

class SprayPathPlannerTest {
    private val config = SprayConfig()

    private fun plan(area: GeoArea, zones: List<NoSprayZone> = emptyList(), cfg: SprayConfig = config): SprayPlan =
        (SprayPathPlanner.plan(area, zones, cfg) as PlanResult.Success).plan

    private fun failure(area: GeoArea, zones: List<NoSprayZone> = emptyList(), cfg: SprayConfig = config) =
        SprayPathPlanner.plan(area, zones, cfg) as PlanResult.Failure

    /** Every flown leg (pass or connector) as a polyline in the test frame. */
    private fun flownPolylines(plan: SprayPlan): List<List<XY>> {
        val out = ArrayList<List<XY>>()
        plan.passes.forEach { out.add(listOf(TestGeo.xy(it.start), TestGeo.xy(it.end))) }
        for (c in plan.connectors) {
            if (c.betweenFlights) continue
            val from = plan.passes[c.fromPass].end
            val to = plan.passes[c.toPass].start
            out.add((listOf(from) + c.via + listOf(to)).map { TestGeo.xy(it) })
        }
        return out
    }

    /** The whole flown route must stay inside the field and keep out of every zone. */
    private fun assertRouteIsSafe(plan: SprayPlan, field: GeoArea, zones: List<NoSprayZone>) {
        val fieldGeometry = Jts.geometry(field, TestGeo.frame).buffer(0.05)
        val zoneGeometry = if (zones.isEmpty()) null
        else UnaryUnionOp.union(zones.mapNotNull { Jts.polygon(it.polygon, TestGeo.frame) })
        for (line in flownPolylines(plan)) {
            val ls = Jts.factory.createLineString(line.map { Coordinate(it.x, it.y) }.toTypedArray())
            assertTrue("route leaves the field: $line", fieldGeometry.covers(ls))
            if (zoneGeometry != null) {
                val inside = zoneGeometry.intersection(ls).length
                assertTrue("route crosses a no-spray zone by $inside m: $line", inside < 0.05)
            }
        }
    }

    // ---- ported from the GARUD prototype and updated for the FieldWise defaults ----

    @Test
    fun rectangleIsSweptAlongItsLongSide() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0))
        assertEquals(0.0, p.headingDeg, 1e-6)
        // Effective swath 4.5 x 0.85 = 3.825 m. The 99 x 49 m flyable area takes rows at 2.41 + 3.825 * i m, up to 49.5 m: 13 rows.
        assertEquals(13, p.passes.size)
        assertTrue("coverage ${p.metrics.coveragePercent}", p.metrics.coveragePercent > 95.0)
    }

    @Test
    fun passesAlternateDirection() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0))
        val heading = p.passes.map { TestGeo.xy(it.end).x - TestGeo.xy(it.start).x }
        for (i in 1 until heading.size) {
            assertTrue("pass $i must reverse pass ${i - 1}", heading[i] * heading[i - 1] < 0)
        }
    }

    @Test
    fun metricsAreDerivedFromTheRealRoute() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0))
        val m = p.metrics
        assertEquals(5000.0, m.fieldAreaSqm, 1.0)
        assertEquals(5000.0, m.sprayableAreaSqm, 1.0)
        assertEquals(0.0, m.noSprayAreaSqm, 1e-6)
        assertEquals(13 * 99.0, m.sprayDistanceM, 0.01)
        assertEquals(12 * 3.825, m.transitDistanceM, 0.01)
        // Two 90 degree corners per turn-around, none before the first pass.
        assertEquals(24, m.turns)
        assertEquals(1, m.sortieCount)
        // (spray + transit) / 4 m/s, plus 3 s per turn.
        assertEquals((13 * 99.0 + 12 * 3.825) / 4.0 / 60.0 + 24 * 3.0 / 60.0, m.flightTimeMin, 0.01)
        // Pass lengths carry ~0.1 mm of projection noise, so compare to a thousandth of a litre.
        assertEquals(13 * 99.0 * 4.5 / 10_000.0 * 12.0, m.chemicalL, 1e-3)
    }

    @Test
    fun smallTankSplitsIntoSorties() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0), cfg = config.copy(tankCapacityL = 1.0))
        assertTrue(p.sorties.size > 1)
        assertEquals(p.passes.size, p.sorties.sumOf { it.passes.size })
        p.sorties.forEach { assertTrue("sortie volume ${it.chemicalL}", it.chemicalL <= 1.0) }
        assertTrue("connectors between flights are marked", p.connectors.any { it.betweenFlights })
        assertEquals(p.metrics.chemicalL, p.sorties.sumOf { it.chemicalL }, 1e-9)
    }

    @Test
    fun batteryLimitAlsoSplitsTheMission() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0), cfg = config.copy(enduranceMin = 2.0))
        assertTrue(p.sorties.size > 1)
        p.sorties.forEach { assertTrue("sortie ${it.index} takes ${it.timeMin} min", it.timeMin <= 2.0) }
    }

    @Test
    fun concaveLShapeIsCoveredAndTheRouteStaysInside() {
        val field = area(0.0 to 0.0, 100.0 to 0.0, 100.0 to 30.0, 30.0 to 30.0, 30.0 to 80.0, 0.0 to 80.0)
        val p = plan(field)
        assertTrue("coverage ${p.metrics.coveragePercent}", p.metrics.coveragePercent > 90.0)
        assertRouteIsSafe(p, field, emptyList())
    }

    // ---- what the FieldWise docs add ----

    @Test
    fun noSprayZoneIsNeverCrossedByPassesOrConnectors() {
        val field = rectArea(0.0, 0.0, 100.0, 50.0)
        val zones = listOf(zone(40.0, 20.0, 60.0, 30.0))
        val p = plan(field, zones)
        assertTrue("the zone adds passes", p.passes.size > 13)
        assertEquals(200.0, p.metrics.noSprayAreaSqm, 1.0)
        assertEquals(4800.0, p.metrics.sprayableAreaSqm, 1.0)
        assertTrue("coverage ${p.metrics.coveragePercent}", p.metrics.coveragePercent > 90.0)
        assertRouteIsSafe(p, field, zones)
    }

    @Test
    fun connectorsDetourAroundAZoneThatWouldOtherwiseBeCrossed() {
        // A long, narrow zone leaves only thin corridors above and below it.
        val field = rectArea(0.0, 0.0, 100.0, 20.0)
        val zones = listOf(zone(45.0, 2.0, 55.0, 18.0))
        val p = plan(field, zones)
        assertTrue("some connector must bend around the zone", p.connectors.any { it.detour && !it.betweenFlights })
        assertEquals(1, p.sorties.size)
        assertRouteIsSafe(p, field, zones)
    }

    @Test
    fun uShapedFieldIsRoutedWithoutLeavingIt() {
        val field = area(
            0.0 to 0.0, 100.0 to 0.0, 100.0 to 60.0, 70.0 to 60.0,
            70.0 to 20.0, 30.0 to 20.0, 30.0 to 60.0, 0.0 to 60.0
        )
        val p = plan(field)
        assertTrue("coverage ${p.metrics.coveragePercent}", p.metrics.coveragePercent > 90.0)
        assertRouteIsSafe(p, field, emptyList())
    }

    @Test
    fun separateAreasEachStartTheirOwnFlight() {
        val field = GeoArea(listOf(rect(0.0, 0.0, 50.0, 50.0), rect(80.0, 0.0, 120.0, 50.0)))
        val p = plan(field)
        assertEquals(2, p.sorties.size)
        assertEquals(1, p.connectors.count { it.betweenFlights })
        assertTrue(p.notes.any { it.contains("separate areas") })
        assertRouteIsSafe(p, field, emptyList())
        // The un-flown hop between the areas is not counted as flight distance.
        assertEquals(p.sorties.sumOf { it.transitDistanceM }, p.metrics.transitDistanceM, 1e-9)
    }

    @Test
    fun aLongNarrowFieldIsSweptAlongItsLength() {
        val p = plan(rectArea(0.0, 0.0, 200.0, 20.0))
        assertEquals(0.0, p.headingDeg, 1e-6)
        assertTrue(p.passes.size <= 6)
    }

    @Test
    fun aRotatedFieldIsSweptAlongItsOwnLongEdge() {
        val angle = Math.toRadians(20.0)
        fun rot(x: Double, y: Double) = (x * cos(angle) - y * sin(angle)) to (x * sin(angle) + y * cos(angle))
        val field = area(rot(0.0, 0.0), rot(120.0, 0.0), rot(120.0, 40.0), rot(0.0, 40.0))
        val p = plan(field)
        assertEquals("heading ${p.headingDeg}", 20.0, p.headingDeg, 0.5)
        assertTrue(p.candidates.count { it.chosen } == 1)
    }

    @Test
    fun aFixedHeadingIsRespected() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0), cfg = config.copy(headingDeg = 90.0))
        assertEquals(90.0, p.headingDeg, 1e-6)
        assertEquals(1, p.candidates.size)
        assertTrue(p.passes.size > 20)
    }

    @Test
    fun theCheapestHeadingWinsUnderTheConfiguredWeights() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 50.0))
        val chosen = p.candidates.single { it.chosen }
        assertTrue(p.candidates.all { it.cost >= chosen.cost - 1e-9 })
        assertTrue("several headings are compared", p.candidates.size >= 12)
    }

    @Test
    fun planningIsDeterministic() {
        val field = area(0.0 to 0.0, 100.0 to 0.0, 100.0 to 30.0, 30.0 to 30.0, 30.0 to 80.0, 0.0 to 80.0)
        assertEquals(plan(field), plan(field))
    }

    @Test
    fun inputsHashChangesWhenAnythingThePlanDependsOnChanges() {
        val field = rectArea(0.0, 0.0, 100.0, 50.0)
        val base = SprayPathPlanner.inputsHash(field, emptyList(), config)
        assertEquals(base, SprayPathPlanner.inputsHash(field, emptyList(), config))
        assertNotEquals(base, SprayPathPlanner.inputsHash(field, emptyList(), config.copy(swathWidthM = 5.0)))
        assertNotEquals(base, SprayPathPlanner.inputsHash(field, listOf(zone(1.0, 1.0, 5.0, 5.0)), config))
        assertNotEquals(base, SprayPathPlanner.inputsHash(rectArea(0.0, 0.0, 101.0, 50.0), emptyList(), config))
    }

    @Test
    fun waypointsFollowTheRouteWithDetourVertices() {
        val p = plan(rectArea(0.0, 0.0, 100.0, 20.0), listOf(zone(45.0, 2.0, 55.0, 18.0)))
        val wps = p.waypoints()
        assertEquals(p.passes.size * 2 + p.connectors.filter { !it.betweenFlights }.sumOf { it.via.size }, wps.size)
        assertEquals(wps.indices.toList(), wps.map { it.seq })
        assertTrue(wps.all { it.altitudeM == config.altitudeM })
        assertEquals(com.fieldwise.model.WaypointAction.SPRAY_ON, wps.first().action)
        assertTrue(wps.any { it.action == com.fieldwise.model.WaypointAction.TRANSIT })
    }

    // ---- refusals ----

    @Test
    fun problemsAreReportedNotThrown() {
        assertEquals(PlanFailure.INVALID_BOUNDARY, failure(GeoArea.EMPTY).reason)
        assertEquals(PlanFailure.INVALID_BOUNDARY, failure(area(0.0 to 0.0, 100.0 to 100.0, 100.0 to 0.0, 0.0 to 100.0)).reason)
        assertEquals(PlanFailure.INVALID_CONFIG, failure(rectArea(0.0, 0.0, 100.0, 50.0), cfg = config.copy(overlapPercent = 100.0)).reason)
        assertEquals(PlanFailure.INVALID_CONFIG, failure(rectArea(0.0, 0.0, 100.0, 50.0), cfg = config.copy(swathWidthM = 0.0)).reason)
        assertEquals(PlanFailure.NOTHING_TO_SPRAY, failure(rectArea(0.0, 0.0, 100.0, 50.0), listOf(zone(-5.0, -5.0, 105.0, 55.0))).reason)
        // 1.5 m square: valid, but nothing is left after the 0.5 m drift margin.
        assertEquals(PlanFailure.TOO_SMALL, failure(area(0.0 to 0.0, 1.5 to 0.0, 1.5 to 1.5, 0.0 to 1.5)).reason)
    }

    @Test
    fun aZoneOutsideTheFieldChangesNothing() {
        val field = rectArea(0.0, 0.0, 100.0, 50.0)
        val without = plan(field)
        val outside = plan(field, listOf(zone(200.0, 0.0, 220.0, 20.0)))
        assertEquals(without.passes.size, outside.passes.size)
        assertEquals(0.0, outside.metrics.noSprayAreaSqm, 1e-6)
    }
}
