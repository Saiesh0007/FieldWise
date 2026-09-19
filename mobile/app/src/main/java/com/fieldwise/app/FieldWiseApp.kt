package com.fieldwise.app

import android.app.Application
import org.osmdroid.config.Configuration
import java.io.File

class FieldWiseApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Keep the tile cache in app-private storage: no storage permission, and it works under scoped storage.
        val config = Configuration.getInstance()
        config.load(this, getSharedPreferences("osmdroid", MODE_PRIVATE))
        config.userAgentValue = packageName
        val base = File(cacheDir, "osmdroid").apply { mkdirs() }
        val tiles = File(base, "tiles").apply { mkdirs() }
        config.osmdroidBasePath = base
        config.osmdroidTileCache = tiles
        config.tileFileSystemCacheMaxBytes = 256L * 1024 * 1024
        config.tileFileSystemCacheTrimBytes = 192L * 1024 * 1024
    }
}
