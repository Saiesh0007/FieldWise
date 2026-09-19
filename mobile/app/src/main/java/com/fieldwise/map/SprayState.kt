package com.fieldwise.map

import com.fieldwise.model.SprayConfig
import com.fieldwise.model.SprayPlan

data class SprayState(
    val config: SprayConfig = SprayConfig(),
    val plan: SprayPlan? = null,
    val planning: Boolean = false,
    val error: String? = null
)
