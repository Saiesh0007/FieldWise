package com.fieldwise.correction

import com.fieldwise.TestGeo.ll
import com.fieldwise.TestGeo.polygon
import com.fieldwise.TestGeo.rect
import com.fieldwise.TestGeo.rectArea
import com.fieldwise.geometry.AreaOps
import com.fieldwise.model.Correction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CorrectionTest {
    private val original = rectArea(0.0, 0.0, 100.0, 50.0)

    private var counter = 0
    private fun add(p: com.fieldwise.model.GeoPolygon) = Correction.AddArea("c${counter++}", 0L, p)
    private fun remove(p: com.fieldwise.model.GeoPolygon) = Correction.RemoveArea("c${counter++}", 0L, p)
    private fun move(fx: Double, fy: Double, tx: Double, ty: Double) =
        Correction.MoveVertex("c${counter++}", 0L, ll(fx, fy), ll(tx, ty))

    private fun applied(area: com.fieldwise.model.GeoArea, c: Correction) =
        (CorrectionEngine.apply(area, c) as ApplyResult.Ok).area

    private fun reason(area: com.fieldwise.model.GeoArea, c: Correction) =
        (CorrectionEngine.apply(area, c) as ApplyResult.Rejected).reason

    @Test
    fun addingANewlyPlantedStripGrowsTheField() {
        val result = applied(original, add(rect(100.0, 0.0, 112.0, 50.0)))
        assertEquals(5000.0 + 600.0, AreaOps.areaSqm(result), 1.0)
        assertEquals(1, result.polygons.size)
    }

    @Test
    fun addingAreaThatIsAlreadyInsideIsRejected() {
        assertEquals("That area is already inside the field.", reason(original, add(rect(10.0, 10.0, 20.0, 20.0))))
    }

    @Test
    fun removingAnOutdatedStripShrinksTheField() {
        val result = applied(original, remove(rect(90.0, -5.0, 105.0, 55.0)))
        assertEquals(4500.0, AreaOps.areaSqm(result), 1.0)
    }

    @Test
    fun removingEverythingOrNothingIsRejected() {
        assertEquals("That would remove the whole field.", reason(original, remove(rect(-10.0, -10.0, 200.0, 100.0))))
        assertEquals("That area doesn't overlap the field.", reason(original, remove(rect(200.0, 0.0, 210.0, 10.0))))
    }

    @Test
    fun aSelfCrossingPolygonIsRejectedBeforeItTouchesTheField() {
        val bowTie = polygon(100.0 to 0.0, 120.0 to 50.0, 120.0 to 0.0, 100.0 to 50.0)
        assertTrue(reason(original, add(bowTie)).contains("overlaps itself"))
    }

    @Test
    fun movingACornerReshapesTheBoundary() {
        // Corner (100, 50) moves to (110, 50): trapezoid with parallel sides 100 and 110, height 50.
        val result = applied(original, move(100.0, 50.0, 110.0, 50.0))
        assertEquals(5250.0, AreaOps.areaSqm(result), 1.0)
    }

    @Test
    fun aMoveThatMakesTheBoundaryCrossItselfIsRejected() {
        assertEquals(
            "That move would make the boundary cross itself.",
            reason(original, move(100.0, 50.0, 50.0, -20.0))
        )
    }

    @Test
    fun movingACornerThatIsNotThereIsRejected() {
        assertEquals("That corner is no longer on the boundary.", reason(original, move(30.0, 30.0, 40.0, 40.0)))
    }

    @Test
    fun replayRebuildsTheSameBoundaryAndNeverTouchesTheOriginal() {
        val corrections = listOf(
            add(rect(100.0, 0.0, 112.0, 50.0)),
            remove(rect(0.0, 0.0, 10.0, 50.0)),
            move(112.0, 50.0, 115.0, 55.0)
        )
        val first = CorrectionEngine.replay(original, corrections)
        val second = CorrectionEngine.replay(original, corrections)
        assertTrue(first.skipped.isEmpty())
        assertEquals(first.area, second.area)
        assertEquals(5000.0, AreaOps.areaSqm(original), 1.0)
        assertFalse(first.area == original)
    }

    @Test
    fun replaySkipsACorrectionThatNoLongerApplies() {
        val result = CorrectionEngine.replay(original, listOf(move(30.0, 30.0, 40.0, 40.0), add(rect(100.0, 0.0, 110.0, 50.0))))
        assertEquals(1, result.skipped.size)
        assertEquals(5500.0, AreaOps.areaSqm(result.area), 1.0)
    }

    @Test
    fun undoAndRedoStepThroughTheHistory() {
        var history = EditHistory.start(original)
        assertFalse(history.canUndo)

        history = (history.apply(add(rect(100.0, 0.0, 110.0, 50.0))) as EditOutcome.Applied).history
        history = (history.apply(remove(rect(0.0, 0.0, 10.0, 50.0))) as EditOutcome.Applied).history
        assertEquals(5000.0, AreaOps.areaSqm(history.corrected), 1.0)
        assertEquals(2, history.applied.size)

        val undone = history.undo()
        assertEquals(5500.0, AreaOps.areaSqm(undone.corrected), 1.0)
        assertTrue(undone.canRedo)

        val redone = undone.redo()
        assertEquals(history.corrected, redone.corrected)
        assertFalse(redone.canRedo)

        val all = undone.undo()
        assertEquals(original, all.corrected)
        assertFalse(all.canUndo)
    }

    @Test
    fun aNewChangeAfterUndoEndsTheRedoBranch() {
        var history = EditHistory.start(original)
        history = (history.apply(add(rect(100.0, 0.0, 110.0, 50.0))) as EditOutcome.Applied).history
        history = history.undo()
        assertTrue(history.canRedo)
        history = (history.apply(add(rect(-10.0, 0.0, 0.0, 50.0))) as EditOutcome.Applied).history
        assertFalse(history.canRedo)
    }

    @Test
    fun aRejectedChangeLeavesTheHistoryUnchanged() {
        val history = EditHistory.start(original)
        val outcome = history.apply(remove(rect(200.0, 0.0, 210.0, 10.0)))
        assertTrue(outcome is EditOutcome.Rejected)
        assertFalse(history.canUndo)
    }

    @Test
    fun startingFromSavedCorrectionsReplaysThem() {
        val saved = listOf(add(rect(100.0, 0.0, 110.0, 50.0)))
        val history = EditHistory.start(original, saved)
        assertEquals(1, history.applied.size)
        assertEquals(5500.0, AreaOps.areaSqm(history.corrected), 1.0)
    }

    @Test
    fun aHoleCornerCanBeMovedToo() {
        val holed = applied(original, remove(rect(40.0, 20.0, 60.0, 30.0)))
        val moved = applied(holed, move(60.0, 30.0, 65.0, 35.0))
        // The hole (40,20) (60,20) (65,35) (40,30) has area 275 by the shoelace formula.
        assertEquals(5000.0 - 275.0, AreaOps.areaSqm(moved), 1.0)
    }
}
