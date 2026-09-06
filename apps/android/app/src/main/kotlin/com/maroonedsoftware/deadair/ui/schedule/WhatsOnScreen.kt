package com.maroonedsoftware.deadair.ui.schedule

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.schedule.ScheduleState
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.Refreshable
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * What is on, and what is on after it.
 *
 * The progress bar moves when the poll moves and not otherwise. That is deliberate and is the same
 * rule the console's strip states: a bar animating between readings would be a second clock, kept
 * by this phone, drifting away from the one the station is actually running on.
 */
@Composable
fun WhatsOnScreen(state: ScheduleState, onRetry: () -> Unit, onSettings: () -> Unit) {
    when (state) {
        ScheduleState.SignedOut -> SignedOutPlaceholder("What's on", onSettings)
        ScheduleState.Loading -> Loading()
        is ScheduleState.Answered ->
            Refreshable(state = state, onRefresh = onRetry) {
                Blocks(whatsOn(state.reading.now, state.reading.slots, state.reading.personas), staleSince = null, stale = false)
            }
        is ScheduleState.Unreachable -> {
            val last = state.lastGood
            if (last == null) {
                ErrorPlaceholder("Could not reach the station", onRetry)
            } else {
                // Kept rather than blanked: what is shown was true a moment ago, and a screen that
                // emptied itself on one failed poll would make every hiccup look like the station
                // losing its schedule. The banner says so; the words stay readable.
                Refreshable(state = state, onRefresh = onRetry) {
                    Blocks(whatsOn(last.now, last.slots, last.personas), staleSince = state.lastGoodAtMs, stale = true)
                }
            }
        }
    }
}

@Composable
private fun Loading() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun Blocks(state: WhatsOnUiState, staleSince: Long?, stale: Boolean) {
    Column(modifier = Modifier.fillMaxSize()) {
        // Above the scrolling part, so it is seen wherever the reader had scrolled to.
        if (stale) StaleBanner(staleSince, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        Column(
            modifier = Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = Gutter, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val onNow = state.onNow) {
                is OnNow.Live -> LiveCard(onNow)
                is OnNow.Between -> BetweenCard(onNow)
            }

            state.ahead.forEach { AheadCard(it) }
        }
    }
}

@Composable
private fun LiveCard(live: OnNow.Live) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Heading(live.eyebrow, live.leftLabel)
            BlockBody(live.block)
            LinearProgressIndicator(progress = { live.progress }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))

            if (live.takenOver) {
                // The word in the eyebrow is the correction; this is why. Without it, a listener is
                // told a show is on while plainly hearing something else.
                Text(
                    "The station is airing something else, which is what happens when it was put on by hand. " +
                        "It moves back to the schedule when the next block begins.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun BetweenCard(between: OnNow.Between) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Heading("Between blocks", "")
            Text("Nothing scheduled", style = MaterialTheme.typography.titleMedium)
            Text(between.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AheadCard(ahead: Ahead) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Heading(ahead.eyebrow, ahead.startsIn)
            BlockBody(ahead.block)
        }
    }
}

@Composable
private fun Heading(eyebrow: String, trailing: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(
            eyebrow.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        if (trailing.isNotEmpty()) {
            Text(trailing, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun BlockBody(block: BlockCard) {
    Text(block.label, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)

    val line = if (block.host == null) block.hours else "${block.hours} · ${block.host}"
    Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

    block.brief?.let {
        Text(
            it,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
