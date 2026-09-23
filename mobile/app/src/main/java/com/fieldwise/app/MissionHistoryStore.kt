package com.fieldwise.app

import android.content.Context
import android.util.Log
import com.fieldwise.mission.MissionJson
import com.fieldwise.mission.MissionRecord
import java.io.File
import java.io.IOException

/**
 * Keeps saved missions in app-private storage so they persist across app closes and phone restarts.
 * Mirrors [FieldStore] but for a list of [MissionRecord] instead of a single [MapState].
 */
class MissionHistoryStore(context: Context) {
    private val dir: File = context.filesDir
    private val file = File(dir, "missions.json")

    /** All saved missions, or an empty list if none exist or the file is unreadable. */
    fun loadAll(): List<MissionRecord> {
        if (!file.exists()) return emptyList()
        val records = try {
            MissionJson.decode(file.readText(Charsets.UTF_8))
        } catch (e: IOException) {
            null
        }
        if (records == null) {
            Log.w(TAG, "Saved missions could not be read; keeping it as missions.unreadable.json")
            file.renameTo(File(dir, "missions.unreadable.json"))
            return emptyList()
        }
        return records
    }

    /** Replaces the entire mission history. Atomic via temp file. */
    fun saveAll(records: List<MissionRecord>) {
        try {
            val temporary = File(dir, "missions.json.tmp")
            temporary.writeText(MissionJson.encode(records), Charsets.UTF_8)
            if (!temporary.renameTo(file)) {
                file.delete()
                temporary.renameTo(file)
            }
        } catch (e: IOException) {
            Log.w(TAG, "Saving missions failed", e)
        }
    }

    private companion object {
        const val TAG = "MissionHistoryStore"
    }
}
