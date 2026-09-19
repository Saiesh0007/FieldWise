package com.fieldwise.app

import android.content.Context
import android.util.Log
import com.fieldwise.map.MapState
import com.fieldwise.storage.FieldJson
import java.io.File
import java.io.IOException

/**
 * Keeps the current field in app-private storage so it is still there after the app is closed, killed or the phone
 * restarts. It works with no connection at all. Writes go to a temporary file first, so a crash mid-save cannot damage
 * the last good copy.
 */
class FieldStore(context: Context) {
    private val dir: File = context.filesDir
    private val file = File(dir, "field.json")

    /** The saved field, or null if there is none. An unreadable file is set aside rather than deleted. */
    fun load(): MapState? {
        if (!file.exists()) return null
        val state = try {
            FieldJson.decode(file.readText(Charsets.UTF_8))
        } catch (e: IOException) {
            null
        }
        if (state == null) {
            Log.w(TAG, "Saved field could not be read; keeping it as field.unreadable.json")
            file.renameTo(File(dir, "field.unreadable.json"))
        }
        return state
    }

    fun save(state: MapState) {
        try {
            val temporary = File(dir, "field.json.tmp")
            temporary.writeText(FieldJson.encode(state), Charsets.UTF_8)
            if (!temporary.renameTo(file)) {
                file.delete()
                temporary.renameTo(file)
            }
        } catch (e: IOException) {
            Log.w(TAG, "Saving the field failed", e)
        }
    }

    private companion object {
        const val TAG = "FieldStore"
    }
}
