package com.fieldwise.correction

import com.fieldwise.TestGeo.ll
import com.fieldwise.TestGeo.rectArea
import com.fieldwise.geo.XY
import com.fieldwise.gps.FixOutcome
import com.fieldwise.gps.GpsCapture
import com.fieldwise.gps.GpsFix
import com.fieldwise.gps.GpsPolicy
import com.fieldwise.gps.GpsWalkSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

class GpsTest {
    private val field = rectArea(0.0, 0.0, 100.0, 50.0)

    /** A walk along the given corners, one fix per metre, all with the given accuracy. */
    private fun walk(vararg corners: Pair<Double, Double>, accuracy: Double = 3.0, dropped: Int = 0): GpsCapture {
        val pts = ArrayList<XY>()
        for (i in 1 until corners.size) {
            val (x0, y0) = corners[i - 1]
            val (x1, y1) = corners[i]
            val n = hypot(x1 - x0, y1 - y0).toInt().coerceAtLeast(1)
            for (k in 0 until n) pts.add(XY(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n))
        }
        pts.add(XY(corners.last().first, corners.last().second))
        val fixes = pts.mapIndexed { i, p -> GpsFix(ll(p.x, p.y), accuracy, 1_000L * i) }
        return GpsCapture(fixes, dropped, 0L, 1_000L * fixes.size)
    }

    private fun ok(r: TrackResult) = (r as TrackResult.Ok).correction

    @Test
    fun aLineWalkedOutsideTheEdgeBecomesAnAddedStrip() {
        val c = ok(GpsTrackConverter.convert(walk(100.0 to 10.0, 110.0 to 10.0, 110.0 to 40.0, 100.0 to 40.0), field))
        assertEquals(CorrectionKind.ADD, c.suggestedKind)
        assertEquals(ClosureMethod.SNAPPED_TO_BOUNDARY, c.method)
        // The correction is the sliver between the old east edge and the walked line: 10 m x 30 m.
        assertEquals(300.0, c.polygonAreaSqm, 2.0)
    }

    @Test
    fun aLineWalkedInsideTheEdgeBecomesARemovedStrip() {
        val c = ok(GpsTrackConverter.convert(walk(100.0 to 10.0, 90.0 to 10.0, 90.0 to 40.0, 100.0 to 40.0), field))
        assertEquals(CorrectionKind.REMOVE, c.suggestedKind)
        assertEquals(ClosureMethod.SNAPPED_TO_BOUNDARY, c.method)
        assertEquals(300.0, c.polygonAreaSqm, 2.0)
    }

    @Test
    fun theConvertedCorrectionAppliesToTheField() {
        val c = ok(GpsTrackConverter.convert(walk(100.0 to 10.0, 110.0 to 10.0, 110.0 to 40.0, 100.0 to 40.0), field))
        val history = EditHistory.start(field)
        val outcome = history.apply(com.fieldwise.model.Correction.AddArea("g", 0L, c.polygon, c.stats))
        val after = (outcome as EditOutcome.Applied).history.corrected
        assertEquals(5000.0 + 300.0, com.fieldwise.geometry.AreaOps.areaSqm(after), 3.0)
        assertEquals(1, after.polygons.size)
    }

    @Test
    fun walkingAlongTheOldEdgeBeforeLeavingItStillGivesTheRealStrip() {
        // Starts on the east edge, follows it for 15 m, then walks out and back. Only 100..110 x 20..40 is new.
        val c = ok(
            GpsTrackConverter.convert(
                walk(100.0 to 5.0, 100.0 to 20.0, 110.0 to 20.0, 110.0 to 40.0, 100.0 to 40.0),
                field
            )
        )
        assertEquals(CorrectionKind.ADD, c.suggestedKind)
        assertEquals(200.0, c.polygonAreaSqm, 2.0)
    }

    @Test
    fun aClosedLoopIsTheCorrectionItself() {
        val c = ok(
            GpsTrackConverter.convert(
                walk(110.0 to 10.0, 120.0 to 10.0, 120.0 to 20.0, 110.0 to 20.0, 110.0 to 10.5),
                field
            )
        )
        assertEquals(ClosureMethod.CLOSED_LOOP, c.method)
        assertEquals(CorrectionKind.ADD, c.suggestedKind)
        assertEquals(100.0, c.polygonAreaSqm, 3.0)
    }

    @Test
    fun aLineFarFromTheBoundaryIsClosedWithAFlaggedStraightLine() {
        val c = ok(GpsTrackConverter.convert(walk(150.0 to 10.0, 160.0 to 10.0, 160.0 to 30.0, 150.0 to 30.0), field))
        assertEquals(ClosureMethod.STRAIGHT_CHORD, c.method)
        assertEquals(200.0, c.polygonAreaSqm, 2.0)
        assertTrue(c.warnings.any { it.contains("straight line") })
    }

    @Test
    fun aVeryShortTrackIsRejected() {
        val r = GpsTrackConverter.convert(walk(100.0 to 10.0, 102.0 to 10.0), field)
        assertTrue(r is TrackResult.Failed)
    }

    @Test
    fun aTrackThatCrossesItselfIsRejected() {
        val figureEight = walk(110.0 to 10.0, 120.0 to 20.0, 120.0 to 10.0, 110.0 to 20.0, 110.0 to 10.5)
        assertTrue(GpsTrackConverter.convert(figureEight, field) is TrackResult.Failed)
    }

    @Test
    fun accuracyIsReportedHonestly() {
        val c = ok(GpsTrackConverter.convert(walk(100.0 to 10.0, 110.0 to 10.0, 110.0 to 40.0, 100.0 to 40.0, accuracy = 8.0, dropped = 4), field))
        assertEquals(8.0, c.stats.meanAccuracyM, 1e-9)
        assertEquals(4, c.stats.droppedFixes)
        assertTrue(c.warnings.any { it.contains("±8 m") })
        assertTrue(c.warnings.any { it.contains("4 fixes were ignored") })
    }

    @Test
    fun goodAccuracyProducesNoWarnings() {
        val c = ok(GpsTrackConverter.convert(walk(100.0 to 10.0, 110.0 to 10.0, 110.0 to 40.0, 100.0 to 40.0, accuracy = 2.0), field))
        assertTrue(c.warnings.isEmpty())
    }

    // ---- session state machine ----

    private fun fix(x: Double, y: Double, acc: Double = 3.0, t: Long = 0L) = GpsFix(ll(x, y), acc, t)

    @Test
    fun sessionRecordsOnlyWhileRecording() {
        val s = GpsWalkSession()
        assertEquals(FixOutcome.IGNORED, s.onFix(fix(0.0, 0.0)))
        s.start(0L)
        assertEquals(FixOutcome.ACCEPTED, s.onFix(fix(0.0, 0.0)))
        s.pause()
        assertEquals(FixOutcome.IGNORED, s.onFix(fix(5.0, 0.0)))
        s.resume()
        assertEquals(FixOutcome.ACCEPTED, s.onFix(fix(10.0, 0.0)))
        assertEquals(2, s.fixCount)
        assertEquals(10.0, s.lengthMeters, 0.05)
    }

    @Test
    fun sessionDropsPoorFixesAndCountsThem() {
        val s = GpsWalkSession()
        s.start(0L)
        assertEquals(FixOutcome.DROPPED_POOR_ACCURACY, s.onFix(fix(0.0, 0.0, acc = 25.0)))
        assertEquals(FixOutcome.ACCEPTED, s.onFix(fix(1.0, 0.0, acc = 6.0)))
        assertEquals(1, s.droppedFixes)
        assertEquals(6.0, s.lastAccuracyM!!, 1e-9)
        assertEquals(1, s.fixCount)
    }

    @Test
    fun sessionIgnoresStandingStillNoise() {
        val s = GpsWalkSession()
        s.start(0L)
        s.onFix(fix(0.0, 0.0))
        assertEquals(FixOutcome.IGNORED, s.onFix(fix(0.2, 0.0)))
        assertEquals(FixOutcome.ACCEPTED, s.onFix(fix(2.0, 0.0)))
    }

    @Test
    fun finishingHandsBackTheCapture() {
        val s = GpsWalkSession()
        s.start(100L)
        s.onFix(fix(0.0, 0.0))
        s.onFix(fix(3.0, 0.0))
        val capture = s.finish(900L)
        assertEquals(GpsWalkSession.State.FINISHED, s.state)
        assertEquals(2, capture.fixes.size)
        assertEquals(100L, capture.startedAt)
        assertEquals(900L, capture.endedAt)
    }

    @Test
    fun policyRatesAndAdvises() {
        assertEquals(GpsPolicy.Rating.GOOD, GpsPolicy.rating(4.8))
        assertEquals(GpsPolicy.Rating.FAIR, GpsPolicy.rating(8.0))
        assertEquals(GpsPolicy.Rating.POOR, GpsPolicy.rating(18.0))
        assertNull(GpsPolicy.advice(4.0))
        assertTrue(GpsPolicy.advice(18.0)!!.contains("Move to an open area"))
        assertTrue(GpsPolicy.advice(null)!!.contains("Waiting"))
    }
}
