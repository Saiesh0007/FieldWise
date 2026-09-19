package com.fieldwise.map

import com.fieldwise.correction.EditHistory
import com.fieldwise.correction.EditOutcome
import com.fieldwise.model.Correction
import com.fieldwise.model.GeoArea

data class BoundaryState(
    val history: EditHistory = EditHistory.start(GeoArea.EMPTY),
    val pendingCorrection: CorrectionPreview? = null,
    /** Why the last correction was refused, until the owner of this state has shown it. */
    val rejection: String? = null
) {
    val corrected: GeoArea get() = history.corrected
    val canUndo: Boolean get() = history.canUndo
    val canRedo: Boolean get() = history.canRedo

    fun applyCorrection(correction: Correction): BoundaryState = when (val outcome = history.apply(correction)) {
        is EditOutcome.Applied -> copy(history = outcome.history, pendingCorrection = null, rejection = null)
        is EditOutcome.Rejected -> copy(pendingCorrection = null, rejection = outcome.reason)
    }

    fun undo(): BoundaryState = copy(history = history.undo())
    fun redo(): BoundaryState = copy(history = history.redo())
    fun setPendingCorrection(preview: CorrectionPreview?): BoundaryState = copy(pendingCorrection = preview)
    fun load(original: GeoArea): BoundaryState =
        copy(history = EditHistory.start(original), pendingCorrection = null, rejection = null)
}
