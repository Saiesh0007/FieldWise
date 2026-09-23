package com.fieldwise.map

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.fieldwise.search.PlaceResult

/**
 * Find a place other than the pilot's own: a name, coordinates in most common forms, or a pasted map link. The
 * matching spot is marked and the map moves to it. The button beside the box returns to the pilot's position.
 */
@Composable
fun PlaceSearchBar(
    search: SearchState,
    onQuery: (String) -> Unit,
    onSubmit: () -> Unit,
    onPick: (PlaceResult) -> Unit,
    onClear: () -> Unit,
    onMyLocation: () -> Unit,
    modifier: Modifier = Modifier
) {
    val focus = LocalFocusManager.current

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextField(
                value = search.query,
                onValueChange = onQuery,
                singleLine = true,
                placeholder = { Text("Search a place, or paste lat, lng") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    when {
                        search.searching -> CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        search.query.isNotEmpty() || search.pin != null ->
                            IconButton(onClick = { focus.clearFocus(); onClear() }) {
                                Icon(Icons.Default.Clear, contentDescription = "Clear search")
                            }
                    }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focus.clearFocus(); onSubmit() }),
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.White,
                    unfocusedContainerColor = Color.White,
                    focusedTextColor = Color.Black,
                    unfocusedTextColor = Color.Black,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    focusedPlaceholderColor = Color.Gray,
                    unfocusedPlaceholderColor = Color.Gray,
                    cursorColor = Color(0xFF1B5E20)
                ),
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = { focus.clearFocus(); onMyLocation() }) {
                Icon(Icons.Default.LocationOn, contentDescription = "Go to my location", tint = Color.White)
            }
        }

        search.message?.let {
            Text(it, color = Color(0xFFFFCC80), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 8.dp))
        }

        if (search.results.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column {
                    search.results.forEachIndexed { index, place ->
                        if (index > 0) Divider()
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { focus.clearFocus(); onPick(place) }
                                .padding(horizontal = 16.dp, vertical = 10.dp)
                        ) {
                            Text(place.name, style = MaterialTheme.typography.bodyMedium, color = Color.Black, maxLines = 2)
                            Text(
                                "%.4f, %.4f".format(place.point.lat, place.point.lng),
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.Gray
                            )
                        }
                    }
                }
            }
        }
    }
}
