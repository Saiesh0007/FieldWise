package com.fieldwise.app

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.fieldwise.mission.ExportFormat
import com.fieldwise.mission.MissionExport
import com.fieldwise.model.Mission
import java.io.File

/** Writes a mission file to the app's cache and hands it to whichever app the pilot picks in the share sheet. */
object MissionSharing {
    /**
     * @throws IllegalStateException if the mission has not been validated and confirmed
     * @throws java.io.IOException if the file cannot be written
     * @throws android.content.ActivityNotFoundException if no app can receive it
     */
    fun share(context: Context, mission: Mission, format: ExportFormat) {
        val text = MissionExport.render(mission, format)

        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, MissionExport.fileName(mission, format))
        file.writeText(text, Charsets.UTF_8)

        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = format.mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "FieldWise mission - ${mission.fieldName}")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "Share ${format.label}"))
    }
}
