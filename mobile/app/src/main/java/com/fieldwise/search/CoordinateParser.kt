package com.fieldwise.search

import com.fieldwise.model.LatLng

sealed interface CoordinateParse {
    data class Found(val point: LatLng) : CoordinateParse

    /** It was meant as coordinates or a map link, but cannot be used. [message] says why. */
    data class Invalid(val message: String) : CoordinateParse

    /** Not coordinates at all: treat it as a place name. */
    object NotCoordinates : CoordinateParse
}

/**
 * Reads a location typed or pasted by the pilot, entirely offline. Understands decimal degrees ("18.5204, 73.8567"),
 * hemisphere letters ("18.5204 N 73.8567 E"), degrees-minutes and degrees-minutes-seconds, and the coordinates inside
 * Google Maps links. Latitude comes first unless a hemisphere letter says otherwise or the first number cannot be one.
 */
object CoordinateParser {
    private const val NUMBER = """-?\d+(?:\.\d+)?"""

    private val linkPatterns = listOf(
        Regex("@($NUMBER),($NUMBER)"),
        Regex("!3d($NUMBER)!4d($NUMBER)"),
        Regex("[?&](?:q|ll|query|center|destination)=($NUMBER)(?:,|%2C)\\s*($NUMBER)", RegexOption.IGNORE_CASE)
    )
    private val token = Regex("$NUMBER|[A-Za-z]+")
    private val punctuation = Regex("""[°º˚′’″”"'`,;/|()]""")

    private const val OUT_OF_RANGE =
        "Latitude must be between -90 and 90, and longitude between -180 and 180."

    fun parse(input: String): CoordinateParse {
        val text = input.trim()
        if (text.isEmpty()) return CoordinateParse.NotCoordinates
        return if (isLink(text)) parseLink(text) else parseNumbers(text)
    }

    private fun isLink(text: String) =
        text.startsWith("http", ignoreCase = true) || text.contains("://") ||
            text.contains("goo.gl", ignoreCase = true) || text.contains("maps.app", ignoreCase = true)

    private fun parseLink(text: String): CoordinateParse {
        for (pattern in linkPatterns) {
            val match = pattern.find(text) ?: continue
            return checked(match.groupValues[1].toDouble(), match.groupValues[2].toDouble())
        }
        return CoordinateParse.Invalid(
            "That link has no coordinates in it. Short links need an internet connection to open. " +
                "Open it in Google Maps, press and hold the spot, and paste the coordinates instead."
        )
    }

    private fun checked(lat: Double, lng: Double): CoordinateParse =
        if (lat in -90.0..90.0 && lng in -180.0..180.0) CoordinateParse.Found(LatLng(lat, lng))
        else CoordinateParse.Invalid(OUT_OF_RANGE)

    private fun parseNumbers(text: String): CoordinateParse {
        val cleaned = text.replace('−', '-').replace(punctuation, " ")
        val tokens = token.findAll(cleaned).map { it.value }.toList()
        // Anything that is not a number, a hemisphere letter or a separator means this is a place name.
        if (cleaned.replace(token, "").isNotBlank()) return CoordinateParse.NotCoordinates

        val numbers = tokens.filter { it[0].isDigit() || it[0] == '-' }
        val letters = tokens.filterNot { it[0].isDigit() || it[0] == '-' }
        if (letters.any { it.length != 1 || it.uppercase() !in listOf("N", "S", "E", "W") }) return CoordinateParse.NotCoordinates
        if (numbers.size !in listOf(2, 4, 6)) return CoordinateParse.NotCoordinates

        val hemispheres = letters.map { it.uppercase()[0] }
        val northSouth = hemispheres.filter { it == 'N' || it == 'S' }
        val eastWest = hemispheres.filter { it == 'E' || it == 'W' }
        if (hemispheres.isNotEmpty() && !(northSouth.size == 1 && eastWest.size == 1)) return CoordinateParse.NotCoordinates

        val half = numbers.size / 2
        val first = angle(numbers.take(half)) ?: return CoordinateParse.Invalid("Minutes and seconds must be below 60.")
        val second = angle(numbers.drop(half)) ?: return CoordinateParse.Invalid("Minutes and seconds must be below 60.")

        if (hemispheres.isEmpty()) {
            // No letters: latitude first, unless the first number cannot be a latitude.
            val swap = kotlin.math.abs(first) > 90.0 && kotlin.math.abs(second) <= 90.0
            return if (swap) checked(second, first) else checked(first, second)
        }

        val longitudeFirst = hemispheres.first() == 'E' || hemispheres.first() == 'W'
        val (latValue, lngValue) = if (longitudeFirst) second to first else first to second
        val lat = kotlin.math.abs(latValue) * if (northSouth[0] == 'S') -1 else 1
        val lng = kotlin.math.abs(lngValue) * if (eastWest[0] == 'W') -1 else 1
        return checked(lat, lng)
    }

    /** Degrees, or degrees + minutes, or degrees + minutes + seconds. Null when minutes or seconds are 60 or more. */
    private fun angle(parts: List<String>): Double? {
        val sign = if (parts[0].startsWith("-")) -1.0 else 1.0
        val degrees = kotlin.math.abs(parts[0].toDouble())
        val minutes = parts.getOrNull(1)?.toDouble() ?: 0.0
        val seconds = parts.getOrNull(2)?.toDouble() ?: 0.0
        if (minutes >= 60.0 || seconds >= 60.0) return null
        return sign * (degrees + minutes / 60.0 + seconds / 3600.0)
    }
}
