package com.fieldwise.mission

import com.fieldwise.model.Mission

/** A saved mission snapshot with a user-friendly name and timestamp. */
data class MissionRecord(
    val name: String,
    val savedAt: Long,
    val mission: Mission
)
