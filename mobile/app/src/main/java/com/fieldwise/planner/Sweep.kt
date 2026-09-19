package com.fieldwise.planner

import com.fieldwise.geo.PlaneMath
import com.fieldwise.geo.XY
import org.locationtech.jts.geom.Coordinate
import kotlin.math.cos
import kotlin.math.sin

/** A straight piece of route, directed from [a] to [b], in the local metric frame. */
internal data class Seg(val a: XY, val b: XY) {
    val length: Double get() = PlaneMath.dist(a, b)
    fun reversed() = Seg(b, a)
}

internal object Sweep {
    /**
     * Parallel sweep lines over a region given as closed rings (exterior and hole rings together).
     * The rings are rotated so passes run along x, every scanline is intersected with every ring edge and the sorted
     * crossings are paired with the even-odd rule, which handles concave outlines and holes alike.
     * Returns one list of segments per scanline that hits the region, left to right in the rotated frame.
     */
    fun rows(rings: List<List<Coordinate>>, angleDeg: Double, spacing: Double, minLength: Double): List<List<Seg>> {
        if (rings.isEmpty() || spacing <= 0.0) return emptyList()
        val rad = Math.toRadians(angleDeg)
        val c = cos(rad)
        val s = sin(rad)
        val rotated = rings.map { ring -> ring.map { XY(it.x * c + it.y * s, -it.x * s + it.y * c) } }
        val minY = rotated.minOf { ring -> ring.minOf { it.y } }
        val maxY = rotated.maxOf { ring -> ring.maxOf { it.y } }

        fun toWorld(x: Double, y: Double) = XY(x * c - y * s, x * s + y * c)

        val rows = mutableListOf<List<Seg>>()
        var i = 0
        while (true) {
            val y = minY + spacing / 2.0 + i * spacing
            if (y > maxY) break
            i++

            val crossings = ArrayList<Double>()
            for (ring in rotated) {
                for (k in 0 until ring.size - 1) {
                    val p = ring[k]
                    val q = ring[k + 1]
                    if ((p.y <= y && y < q.y) || (q.y <= y && y < p.y)) {
                        crossings.add(p.x + (y - p.y) / (q.y - p.y) * (q.x - p.x))
                    }
                }
            }
            crossings.sort()

            val row = mutableListOf<Seg>()
            var k = 0
            while (k + 1 < crossings.size) {
                if (crossings[k + 1] - crossings[k] >= minLength) {
                    row.add(Seg(toWorld(crossings[k], y), toWorld(crossings[k + 1], y)))
                }
                k += 2
            }
            if (row.isNotEmpty()) rows.add(row)
        }
        return rows
    }
}
