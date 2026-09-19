package com.fieldwise.correction

import com.fieldwise.model.Correction
import com.fieldwise.model.GeoArea

sealed interface EditOutcome {
    data class Applied(val history: EditHistory) : EditOutcome
    data class Rejected(val reason: String) : EditOutcome
}

/**
 * Immutable undo/redo history over the corrections of one field. The original boundary is kept untouched;
 * every intermediate result is stored so that undo and redo are instant.
 */
class EditHistory private constructor(
    val original: GeoArea,
    val applied: List<Correction>,
    private val states: List<GeoArea>,
    private val redoStack: List<Pair<Correction, GeoArea>>
) {
    /** The boundary after all applied corrections. */
    val corrected: GeoArea get() = states.last()
    val canUndo: Boolean get() = applied.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()

    fun apply(correction: Correction): EditOutcome =
        when (val r = CorrectionEngine.apply(corrected, correction)) {
            is ApplyResult.Rejected -> EditOutcome.Rejected(r.reason)
            // A new change ends the redo branch.
            is ApplyResult.Ok -> EditOutcome.Applied(
                EditHistory(original, applied + correction, states + r.area, emptyList())
            )
        }

    fun undo(): EditHistory {
        if (!canUndo) return this
        return EditHistory(
            original,
            applied.dropLast(1),
            states.dropLast(1),
            redoStack + (applied.last() to states.last())
        )
    }

    fun redo(): EditHistory {
        if (!canRedo) return this
        val (correction, state) = redoStack.last()
        return EditHistory(original, applied + correction, states + state, redoStack.dropLast(1))
    }

    companion object {
        /** Starts from a saved field: replays [saved] over [original], dropping any that no longer apply. */
        fun start(original: GeoArea, saved: List<Correction> = emptyList()): EditHistory {
            var history = EditHistory(original, emptyList(), listOf(original), emptyList())
            for (c in saved) {
                val outcome = history.apply(c)
                if (outcome is EditOutcome.Applied) history = outcome.history
            }
            return history
        }
    }
}
