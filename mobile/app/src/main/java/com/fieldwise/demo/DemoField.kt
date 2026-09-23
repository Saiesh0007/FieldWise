package com.fieldwise.demo

import com.fieldwise.model.GeoArea
import com.fieldwise.model.GeoPolygon
import com.fieldwise.model.LatLng
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.SprayConfig
import com.fieldwise.model.ZoneKind

/**
 * Sample field near Pune with boundary and obstacle zones for path planning.
 */
object DemoField {
    val boundary: GeoPolygon by lazy {
        GeoPolygon(
            listOf(
                LatLng(18.520, 73.856),
                LatLng(18.519, 73.872),
                LatLng(18.524, 73.875),
                LatLng(18.530, 73.873),
                LatLng(18.535, 73.865),
                LatLng(18.532, 73.856),
                LatLng(18.528, 73.852),
                LatLng(18.522, 73.854)
            )
        )
    }

    /** Obstacles: pond, house, tree and electric pole within the field. */
    val obstacles: List<NoSprayZone> by lazy {
        listOf(
            NoSprayZone(
                id = "demo_pond",
                name = "Pond",
                kind = ZoneKind.WATER,
                polygon = GeoPolygon(
                    listOf(
                        LatLng(18.526, 73.861),
                        LatLng(18.526, 73.864),
                        LatLng(18.528, 73.864),
                        LatLng(18.528, 73.861)
                    )
                ),
                createdAt = 0L
            ),
            NoSprayZone(
                id = "demo_house",
                name = "House",
                kind = ZoneKind.BUILDING,
                polygon = GeoPolygon(
                    listOf(
                        LatLng(18.522, 73.858),
                        LatLng(18.522, 73.860),
                        LatLng(18.524, 73.860),
                        LatLng(18.524, 73.858)
                    )
                ),
                createdAt = 0L
            ),
            NoSprayZone(
                id = "demo_tree",
                name = "Tree",
                kind = ZoneKind.TREE,
                polygon = GeoPolygon(
                    listOf(
                        LatLng(18.531, 73.868),
                        LatLng(18.531, 73.869),
                        LatLng(18.532, 73.869),
                        LatLng(18.532, 73.868)
                    )
                ),
                createdAt = 0L
            ),
            NoSprayZone(
                id = "demo_pole",
                name = "Electric pole",
                kind = ZoneKind.POLE,
                polygon = GeoPolygon(
                    listOf(
                        LatLng(18.525, 73.870),
                        LatLng(18.525, 73.871),
                        LatLng(18.526, 73.871),
                        LatLng(18.526, 73.870)
                    )
                ),
                createdAt = 0L
            )
        )
    }

    /** Spray configuration: realistic parameters for a small agricultural drone. */
    val config: SprayConfig = SprayConfig(
        swathWidthM = 4.5,
        overlapPercent = 15.0,
        speedMps = 4.0,
        altitudeM = 3.0,
        applicationRateLPerHa = 12.0,
        tankCapacityL = 10.0,
        enduranceMin = 20.0,
        turnPenaltySec = 3.0,
        driftInsetM = 0.5
    )

    /** The field ready to plan: boundary + obstacles + config. */
    fun asGeoArea(): GeoArea = GeoArea.of(boundary)

    override fun toString(): String = "Demo field near Pune: ${boundary.shell.size} corners, ${obstacles.size} obstacles"
}
