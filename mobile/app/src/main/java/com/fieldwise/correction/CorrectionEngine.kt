package com.fieldwise.correction

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geo.PlaneMath
import com.fieldwise.geometry.AreaOps
import com.fieldwise.model.Correction
import com.fieldwise.model.GeoArea
import com.fieldwise.model.LatLng

sealed interface ApplyResult {
    data class Ok(val area: GeoArea) : ApplyResult
    data class Rejected(val reason: String) : ApplyResult
}

data class Replay(val area: GeoArea, val skipped: List<Correction>)

/**
 * Corrected field = original, then each correction in order (union for added areas, difference for removed areas,
 * vertex replacement for moves). A correction that would produce an invalid boundary is rejected, never half-applied.
 */
object CorrectionEngine {
    private const val MOVE_MATCH_TOLERANCE_M = 2.0

    fun apply(area: GeoArea, correction: Correction): ApplyResult =
        try {
            when (correction) {
                is Correction.AddArea -> add(area, correction)
                is Correction.RemoveArea -> remove(area, correction)
                is Correction.MoveVertex -> move(area, correction.from, correction.to)
            }
        } catch (e: RuntimeException) {
            ApplyResult.Rejected("That change can't be applied to this boundary shape.")
        }

    /** Rebuilds the corrected boundary. Corrections that no longer apply are reported in [Replay.skipped]. */
    fun replay(original: GeoArea, corrections: List<Correction>): Replay {
        var area = original
        val skipped = mutableListOf<Correction>()
        for (c in corrections) {
            when (val r = apply(area, c)) {
                is ApplyResult.Ok -> area = r.area
                is ApplyResult.Rejected -> skipped.add(c)
            }
        }
        return Replay(area, skipped)
    }

    private fun add(area: GeoArea, c: Correction.AddArea): ApplyResult {
        AreaOps.validate(c.polygon).firstOrNull()?.let { return ApplyResult.Rejected(it.message) }
        val result = AreaOps.cleaned(AreaOps.union(area, c.polygon))
        if (AreaOps.areaSqm(result) - AreaOps.areaSqm(area) < AreaOps.SLIVER_SQM) {
            return ApplyResult.Rejected("That area is already inside the field.")
        }
        return ApplyResult.Ok(result)
    }

    private fun remove(area: GeoArea, c: Correction.RemoveArea): ApplyResult {
        AreaOps.validate(c.polygon).firstOrNull()?.let { return ApplyResult.Rejected(it.message) }
        val result = AreaOps.cleaned(AreaOps.difference(area, c.polygon))
        if (result.isEmpty) return ApplyResult.Rejected("That would remove the whole field.")
        if (AreaOps.areaSqm(area) - AreaOps.areaSqm(result) < AreaOps.SLIVER_SQM) {
            return ApplyResult.Rejected("That area doesn't overlap the field.")
        }
        return ApplyResult.Ok(result)
    }

    /** The vertex is found by position, so replay does not depend on how a boolean operation ordered the rings. */
    private fun move(area: GeoArea, from: LatLng, to: LatLng): ApplyResult {
        val proj = LocalProjection.around(area.allPoints())
        val target = proj.toLocal(from)
        var found: Triple<Int, Int, Int>? = null
        var bestDistance = Double.MAX_VALUE
        area.polygons.forEachIndexed { pi, polygon ->
            polygon.rings().forEachIndexed { ri, ring ->
                ring.forEachIndexed { vi, v ->
                    val d = PlaneMath.dist(proj.toLocal(v), target)
                    if (d < bestDistance) {
                        bestDistance = d
                        found = Triple(pi, ri, vi)
                    }
                }
            }
        }
        val (pi, ri, vi) = found ?: return ApplyResult.Rejected("That corner is no longer on the boundary.")
        if (bestDistance > MOVE_MATCH_TOLERANCE_M) {
            return ApplyResult.Rejected("That corner is no longer on the boundary.")
        }

        val moved = area.polygons.mapIndexed { i, polygon ->
            when {
                i != pi -> polygon
                ri == 0 -> polygon.copy(shell = polygon.shell.replaced(vi, to))
                else -> polygon.copy(holes = polygon.holes.mapIndexed { h, ring -> if (h == ri - 1) ring.replaced(vi, to) else ring })
            }
        }
        val result = GeoArea(moved)
        if (AreaOps.validate(result).isNotEmpty()) {
            return ApplyResult.Rejected("That move would make the boundary cross itself.")
        }
        return ApplyResult.Ok(result)
    }

    private fun List<LatLng>.replaced(index: Int, value: LatLng): List<LatLng> =
        mapIndexed { i, p -> if (i == index) value else p }
}
