package com.maroonedsoftware.deadair.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * What a screen says when its reading is no longer current.
 *
 * At full opacity, above the content, rather than the content dimmed to forty percent. Dimming a
 * whole screen took every line of body text — already in the quieter colour — below any contrast a
 * person with ordinary eyesight can read, and the sentence explaining the dimming was dimmed with
 * it. What is shown was true a moment ago; the banner says when, and the pictures fade a little to
 * mark them as not current. The words stay readable, because the words are the point.
 */
@Composable
fun StaleBanner(lastGoodAtMs: Long?, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        shape = RoundedCornerShape(8.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            text =
                if (lastGoodAtMs == null) {
                    "Could not reach the station just now. This is the last it said."
                } else {
                    "Could not reach the station just now. Showing what it said at ${clockOf(lastGoodAtMs)}."
                },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        )
    }
}

private fun clockOf(epochMs: Long): String = Instant.ofEpochMilli(epochMs).atZone(ZoneId.systemDefault()).format(CLOCK)

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
