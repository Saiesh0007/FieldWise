package com.fieldwise.app

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import androidx.annotation.RequiresApi
import com.fieldwise.model.LatLng
import com.fieldwise.search.PlaceResult
import com.fieldwise.search.PlaceSearch
import com.fieldwise.search.SearchOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Looks place names up with Android's own geocoder. It needs no account or key and sends nothing but the typed text.
 * It needs an internet connection; coordinates never come here, so those keep working offline.
 */
class GeocoderPlaceSearch(private val context: Context) : PlaceSearch {
    override suspend fun search(query: String): SearchOutcome {
        if (!Geocoder.isPresent()) {
            return SearchOutcome.Failed("Place search is not available on this phone. Paste coordinates instead, for example 18.5204, 73.8567.")
        }
        val addresses = try {
            lookup(Geocoder(context, Locale.getDefault()), query)
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            return SearchOutcome.Failed("The search service could not be reached. Check your internet connection, or paste coordinates instead.")
        } catch (e: IllegalArgumentException) {
            return SearchOutcome.NotFound
        }
        val places = addresses.filter { it.hasLatitude() && it.hasLongitude() }.map { toPlace(it) }.distinctBy { it.name }
        return if (places.isEmpty()) SearchOutcome.NotFound else SearchOutcome.Found(places)
    }

    private suspend fun lookup(geocoder: Geocoder, query: String): List<Address> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            lookupAsync(geocoder, query)
        } else {
            withContext(Dispatchers.IO) {
                @Suppress("DEPRECATION")
                geocoder.getFromLocationName(query, MAX_RESULTS) ?: emptyList()
            }
        }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private suspend fun lookupAsync(geocoder: Geocoder, query: String): List<Address> =
        suspendCancellableCoroutine { continuation ->
            geocoder.getFromLocationName(query, MAX_RESULTS, object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) {
                    continuation.resume(addresses)
                }

                override fun onError(errorMessage: String?) {
                    continuation.resumeWithException(IOException(errorMessage ?: "The geocoder failed."))
                }
            })
        }

    private fun toPlace(a: Address): PlaceResult {
        val line = a.getAddressLine(0)?.trim().orEmpty()
        val fallback = listOfNotNull(a.featureName, a.locality, a.subAdminArea, a.adminArea, a.countryName)
            .distinct().joinToString(", ")
        return PlaceResult(
            name = line.ifEmpty { fallback }.ifEmpty { "Unnamed place" },
            point = LatLng(a.latitude, a.longitude),
            zoom = PLACE_ZOOM
        )
    }

    private companion object {
        const val MAX_RESULTS = 5
        const val PLACE_ZOOM = 15.0
    }
}
