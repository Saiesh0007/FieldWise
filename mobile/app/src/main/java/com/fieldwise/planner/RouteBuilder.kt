package com.fieldwise.planner

import com.fieldwise.geo.PlaneMath
import com.fieldwise.geo.XY

/** One pass plus the way to reach it from the previous pass. */
internal class RouteLeg(
    val seg: Seg,
    /** Path from the previous pass's end to this pass's start, both included. Null for the first pass of a flight. */
    val connector: List<XY>?,
    /** True when no in-area path exists from the previous pass, so this pass starts a new flight. */
    val newFlight: Boolean
) {
    val connectorLength: Double get() = connector?.let { PlaneMath.pathLength(it) } ?: 0.0
    val detour: Boolean get() = (connector?.size ?: 0) > 2
}

internal object RouteBuilder {
    /**
     * Orders the passes of one sweep into a route. It always continues with the pass whose nearest end is cheapest to
     * reach by an in-area path, so on a plain field it produces the usual back-and-forth pattern, and around
     * obstacles it finishes one side before crossing over. A pass in a separate region starts a new flight.
     */
    fun build(rows: List<List<Seg>>, area: FlightArea): List<RouteLeg> {
        val segs = rows.flatten()
        if (segs.isEmpty()) return emptyList()

        val remaining = segs.indices.toMutableList()
        val legs = ArrayList<RouteLeg>(segs.size)

        legs.add(RouteLeg(segs[0], null, false))
        remaining.remove(0)
        var position = segs[0].b

        class Candidate(val distance: Double, val index: Int, val flip: Boolean)

        while (remaining.isNotEmpty()) {
            val candidates = ArrayList<Candidate>(remaining.size * 2)
            for (i in remaining) {
                candidates.add(Candidate(PlaneMath.dist(position, segs[i].a), i, false))
                candidates.add(Candidate(PlaneMath.dist(position, segs[i].b), i, true))
            }
            candidates.sortBy { it.distance }

            var best: Candidate? = null
            var bestPath: List<XY>? = null
            var bestCost = Double.POSITIVE_INFINITY
            for (c in candidates) {
                // A path is never shorter than the straight distance, so nothing further can win.
                if (c.distance >= bestCost) break
                val entry = if (c.flip) segs[c.index].b else segs[c.index].a
                val path = area.path(position, entry) ?: continue
                val cost = PlaneMath.pathLength(path)
                if (cost < bestCost) {
                    best = c
                    bestPath = path
                    bestCost = cost
                }
            }

            if (best == null) {
                val c = candidates.first()
                val oriented = if (c.flip) segs[c.index].reversed() else segs[c.index]
                legs.add(RouteLeg(oriented, null, true))
                remaining.remove(c.index)
                position = oriented.b
            } else {
                val oriented = if (best.flip) segs[best.index].reversed() else segs[best.index]
                legs.add(RouteLeg(oriented, bestPath, false))
                remaining.remove(best.index)
                position = oriented.b
            }
        }
        return legs
    }
}

internal object Turns {
    const val MIN_TURN_DEG = 30.0

    /**
     * For each leg, the number of heading changes of at least [MIN_TURN_DEG] on the way through its connector and
     * along its pass. The first pass of a flight has none.
     */
    fun into(legs: List<RouteLeg>): IntArray {
        val result = IntArray(legs.size)
        var heading: Double? = null
        legs.forEachIndexed { i, leg ->
            if (i == 0 || leg.newFlight) heading = null
            var turns = 0
            fun visit(a: XY, b: XY) {
                if (PlaneMath.dist(a, b) < 1e-6) return
                val h = PlaneMath.headingDeg(a, b)
                val previous = heading
                if (previous != null && PlaneMath.headingDiffDeg(previous, h) >= MIN_TURN_DEG) turns++
                heading = h
            }
            leg.connector?.let { c -> for (k in 1 until c.size) visit(c[k - 1], c[k]) }
            visit(leg.seg.a, leg.seg.b)
            result[i] = turns
        }
        return result
    }
}
