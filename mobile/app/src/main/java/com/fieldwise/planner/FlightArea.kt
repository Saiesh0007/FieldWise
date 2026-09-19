package com.fieldwise.planner

import com.fieldwise.geo.PlaneMath
import com.fieldwise.geo.XY
import com.fieldwise.geometry.Jts
import org.locationtech.jts.algorithm.Orientation
import org.locationtech.jts.geom.Coordinate
import org.locationtech.jts.geom.Geometry
import org.locationtech.jts.geom.Polygon
import org.locationtech.jts.geom.prep.PreparedGeometry
import org.locationtech.jts.geom.prep.PreparedGeometryFactory

/**
 * The region the drone may fly in: the field, pulled in by the drift margin, minus the no-spray zones plus that margin.
 * Answers "can I fly straight from a to b?" and, if not, finds the shortest detour that stays inside
 * (a visibility graph over the reflex corners of the region, searched with A*).
 */
internal class FlightArea(flyable: Geometry, tolerance: Double = 0.02) {
    private class Part(val prepared: PreparedGeometry, val corners: List<XY>) {
        val visibleCache = HashMap<Long, Boolean>()
    }

    private val parts: List<Part>

    init {
        val polygons = (0 until flyable.numGeometries).mapNotNull { flyable.getGeometryN(it) as? Polygon }
        // The tolerance absorbs floating-point error for points that lie exactly on the boundary.
        parts = polygons.map { Part(PreparedGeometryFactory.prepare(it.buffer(tolerance)), reflexCorners(it)) }
    }

    /** Which separate region the point is in, or -1. Regions cannot be connected by any in-area path. */
    fun regionOf(p: XY): Int {
        val point = Jts.factory.createPoint(Coordinate(p.x, p.y))
        return parts.indexOfFirst { it.prepared.covers(point) }
    }

    fun canFlyStraight(a: XY, b: XY): Boolean {
        val region = regionOf(a)
        return region >= 0 && straight(parts[region], a, b)
    }

    private fun straight(part: Part, a: XY, b: XY): Boolean {
        if (PlaneMath.dist(a, b) < 1e-9) return true
        val line = Jts.factory.createLineString(arrayOf(Coordinate(a.x, a.y), Coordinate(b.x, b.y)))
        return part.prepared.covers(line)
    }

    /** Shortest in-area path from [a] to [b], both ends included, or null when they are in different regions. */
    fun path(a: XY, b: XY): List<XY>? {
        val ra = regionOf(a)
        if (ra < 0 || ra != regionOf(b)) return null
        val part = parts[ra]
        if (straight(part, a, b)) return listOf(a, b)

        val n = part.corners.size
        val pts = part.corners + a + b
        val start = n
        val goal = n + 1
        val g = DoubleArray(n + 2) { Double.POSITIVE_INFINITY }
        val previous = IntArray(n + 2) { -1 }
        val closed = BooleanArray(n + 2)
        g[start] = 0.0

        while (true) {
            var current = -1
            var bestF = Double.POSITIVE_INFINITY
            for (i in 0 until n + 2) {
                if (closed[i] || g[i].isInfinite()) continue
                val f = g[i] + PlaneMath.dist(pts[i], pts[goal])
                if (f < bestF) {
                    bestF = f
                    current = i
                }
            }
            if (current == -1) return null
            if (current == goal) break
            closed[current] = true
            for (j in 0 until n + 2) {
                if (closed[j]) continue
                val through = g[current] + PlaneMath.dist(pts[current], pts[j])
                if (through >= g[j]) continue
                if (!cornerVisible(part, pts, current, j, n)) continue
                g[j] = through
                previous[j] = current
            }
        }

        val route = ArrayList<XY>()
        var i = goal
        while (i != -1) {
            route.add(pts[i])
            i = previous[i]
        }
        return route.reversed()
    }

    private fun cornerVisible(part: Part, pts: List<XY>, i: Int, j: Int, cornerCount: Int): Boolean {
        // Corner-to-corner answers do not depend on the query, so they are cached.
        if (i < cornerCount && j < cornerCount) {
            val key = minOf(i, j).toLong() * cornerCount + maxOf(i, j)
            return part.visibleCache.getOrPut(key) { straight(part, pts[i], pts[j]) }
        }
        return straight(part, pts[i], pts[j])
    }

    private fun reflexCorners(polygon: Polygon): List<XY> {
        val out = ArrayList<XY>()
        addReflex(polygon.exteriorRing.coordinates, isShell = true, out = out)
        for (h in 0 until polygon.numInteriorRing) addReflex(polygon.getInteriorRingN(h).coordinates, isShell = false, out = out)
        return out
    }

    /** A corner where the region's interior angle exceeds 180 degrees; shortest paths only bend at such corners. */
    private fun addReflex(closed: Array<Coordinate>, isShell: Boolean, out: MutableList<XY>) {
        val n = closed.size - 1
        if (n < 3) return
        val counterClockwise = Orientation.isCCW(closed)
        val interiorOnLeft = if (isShell) counterClockwise else !counterClockwise
        for (i in 0 until n) {
            val prev = closed[(i + n - 1) % n]
            val cur = closed[i]
            val next = closed[i + 1]
            val cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)
            val reflex = if (interiorOnLeft) cross < -1e-9 else cross > 1e-9
            if (reflex) out.add(XY(cur.x, cur.y))
        }
    }
}
