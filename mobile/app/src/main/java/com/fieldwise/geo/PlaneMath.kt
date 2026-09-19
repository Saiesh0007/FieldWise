package com.fieldwise.geo

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot

/** Small planar helpers on [XY] points (metres). */
object PlaneMath {
    fun dist(a: XY, b: XY): Double = hypot(b.x - a.x, b.y - a.y)

    fun shoelaceArea(points: List<XY>): Double {
        if (points.size < 3) return 0.0
        var area = 0.0
        for (i in points.indices) {
            val j = (i + 1) % points.size
            area += points[i].x * points[j].y - points[j].x * points[i].y
        }
        return abs(area) / 2.0
    }

    fun pathLength(points: List<XY>): Double {
        var total = 0.0
        for (i in 1 until points.size) total += dist(points[i - 1], points[i])
        return total
    }

    /** Keeps a point only when it is at least [minDistance] from the previously kept one. The first and last are kept. */
    fun thin(points: List<XY>, minDistance: Double): List<XY> {
        if (points.size < 2) return points
        val out = mutableListOf(points.first())
        for (i in 1 until points.size - 1) {
            if (dist(out.last(), points[i]) >= minDistance) out.add(points[i])
        }
        val last = points.last()
        if (dist(out.last(), last) > 1e-9) {
            // Do not leave a stub shorter than half the spacing at the end: replace instead of append.
            if (out.size > 1 && dist(out.last(), last) < minDistance / 2.0) out[out.size - 1] = last else out.add(last)
        }
        return out
    }

    /** Heading of a->b in degrees, 0 = +x axis, counter-clockwise. */
    fun headingDeg(a: XY, b: XY): Double = Math.toDegrees(atan2(b.y - a.y, b.x - a.x))

    /** Smallest absolute difference between two headings, 0..180. */
    fun headingDiffDeg(h1: Double, h2: Double): Double {
        var d = abs(h1 - h2) % 360.0
        if (d > 180.0) d = 360.0 - d
        return d
    }

    /** Sweep direction of the longest edge of a ring, folded into 0..180. */
    fun longestEdgeAngle(ring: List<XY>): Double {
        if (ring.size < 2) return 0.0
        var best = 0.0
        var angle = 0.0
        for (i in ring.indices) {
            val a = ring[i]
            val b = ring[(i + 1) % ring.size]
            val len = dist(a, b)
            if (len > best) {
                best = len
                angle = headingDeg(a, b)
            }
        }
        return normalizeAngle(angle)
    }

    /** Folds any angle into 0..180 (a sweep direction is undirected). */
    fun normalizeAngle(degrees: Double): Double = ((degrees % 180.0) + 180.0) % 180.0

    fun distanceToSegment(p: XY, a: XY, b: XY): Double {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val len2 = dx * dx + dy * dy
        val t = if (len2 == 0.0) 0.0 else (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).coerceIn(0.0, 1.0)
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }
}
