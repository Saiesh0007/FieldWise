package com.fieldwise.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fieldwise.geometry.AreaOps
import com.fieldwise.model.NoSprayZone
import com.fieldwise.model.ZoneKind

/** Shown while a no-spray zone is being drawn: pick what it is, tap its corners on the map, then finish. */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ZoneDraftPanel(
    draft: ZoneDraft,
    onKind: (ZoneKind) -> Unit,
    onFinish: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(8.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = 0.95f))
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("New no-spray zone", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                "Choose what it is, then tap its corners on the map. The route will keep out of it.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.DarkGray
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ZoneKind.values().forEach { kind ->
                    FilterChip(selected = draft.kind == kind, onClick = { onKind(kind) }, label = { Text(kind.label) })
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = onCancel,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.Gray)
                ) { Text("Cancel") }
                Button(
                    onClick = onFinish,
                    enabled = draft.corners.size >= 3,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD32F2F))
                ) { Text("Finish zone (${draft.corners.size})") }
            }
        }
    }
}

/** The zones already drawn, with a way to remove each, and the button that starts a new one. */
@Composable
fun ZonesSection(zones: List<NoSprayZone>, onAddZone: () -> Unit, onRemoveZone: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 8.dp)) {
        Text("No-spray zones", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Color(0xFFD32F2F))
        if (zones.isEmpty()) {
            Text(
                "None yet. Mark water, buildings, roads or anything the drone must not spray.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray
            )
        }
        zones.forEach { zone ->
            val hectares = remember(zone) { AreaOps.areaSqm(zone.polygon) / 10_000.0 }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(Color(0xFFFF1744)))
                Text(
                    "  ${zone.name}  ·  %.2f ha".format(hectares),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = { onRemoveZone(zone.id) }) { Text("Remove") }
            }
        }
        TextButton(onClick = onAddZone) { Text("+ Add no-spray zone") }
    }
}
