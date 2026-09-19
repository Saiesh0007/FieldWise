package com.fieldwise

import com.fieldwise.geo.LocalProjection
import com.fieldwise.geo.XY
import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.ZoneKind

/** Builds test geometry from metre coordinates in a fixed local frame, so expectations can be worked out by hand. */
object TestGeo {
    val frame = LocalProjection(18.5204, 73.8567)

    fun ll(x: Double, y: Double): LatLng = frame.toGeo(XY(x, y))

    fun xy(p: LatLng): XY = frame.toLocal(p)

    fun polygon(vararg xy: Pair<Double, Double>) = GeoPolygon(xy.map { ll(it.first, it.second) })

    fun area(vararg xy: Pair<Double, Double>) = GeoArea.of(polygon(*xy))

    fun rect(x0: Double, y0: Double, x1: Double, y1: Double) = polygon(x0 to y0, x1 to y0, x1 to y1, x0 to y1)

    fun rectArea(x0: Double, y0: Double, x1: Double, y1: Double) = GeoArea.of(rect(x0, y0, x1, y1))

    fun zone(x0: Double, y0: Double, x1: Double, y1: Double, id: String = "z") =
        NoSprayZone(id, id, ZoneKind.OBSTACLE, rect(x0, y0, x1, y1), 0L)
}
