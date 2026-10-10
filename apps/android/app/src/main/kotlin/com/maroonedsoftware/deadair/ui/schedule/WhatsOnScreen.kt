package com.maroonedsoftware.deadair.ui.schedule

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.schedule.ScheduleState
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.Refreshable
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * What is on, and what is on after it.
 *
 * The progress bar moves when the poll moves and not otherwise. That is deliberate and is the same
 * rule the console's strip states: a bar animating between readings would be a second clock, kept
 * by this phone, drifting away from the one the station is actually running on.
 */
@Composable
fun WhatsOnScreen(
    state: ScheduleState,
    /** Turns a station path (a host's portrait) into something an image loader can fetch. */
    artUrlFor: (String?) -> String?,
    onRetry: () -> Unit,
    onSignIn: () -> Unit,
) {
    when (state) {
        ScheduleState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.tab_whats_on), onSignIn)
        ScheduleState.Loading -> Loading()
        is ScheduleState.Answered ->
            Refreshable(state = state, onRefresh = onRetry) {
                Blocks(whatsOn(state.reading.now, state.reading.slots, state.reading.personas, state.reading.portraits), artUrlFor, staleSince = null, stale = false)
            }
        is ScheduleState.Unreachable -> {
            val last = state.lastGood
            if (last == null) {
                ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
            } else {
                // Kept rather than blanked: what is shown was true a moment ago, and a screen that
                // emptied itself on one failed poll would make every hiccup look like the station
                // losing its schedule. The banner says so; the words stay readable.
                Refreshable(state = state, onRefresh = onRetry) {
                    Blocks(whatsOn(last.now, last.slots, last.personas, last.portraits), artUrlFor, staleSince = state.lastGoodAtMs, stale = true)
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
private fun Blocks(state: WhatsOnUiState, artUrlFor: (String?) -> String?, staleSince: Long?, stale: Boolean) {
    Column(modifier = Modifier.fillMaxSize()) {
        // Above the scrolling part, so it is seen wherever the reader had scrolled to.
        if (stale) StaleBanner(staleSince, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        Column(
            modifier = Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = Gutter, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val onNow = state.onNow) {
                is OnNow.Live -> LiveCard(onNow, artUrlFor)
                is OnNow.Between -> BetweenCard(onNow)
            }

            // Keyed on the block, so a card opened to read it stays with that block when a poll moves
            // it from "after that" to "up next", rather than staying in the slot it was opened in.
            state.ahead.forEach { key(it.block) { AheadCard(it, artUrlFor) } }
        }
    }
}

@Composable
private fun LiveCard(live: OnNow.Live, artUrlFor: (String?) -> String?) {
    ExpandableCard(live.block) { expanded, onTruncated ->
        Heading(live.eyebrow.resolve(), live.leftLabel.resolve())
        BlockBody(live.block, artUrlFor, expanded, onTruncated)
        // Silent to a screen reader: the "left" label beside the eyebrow already says how far
        // through the block it is, and a bar announcing a percentage on top of it said the
        // same thing twice in two units.
        LinearProgressIndicator(progress = { live.progress }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp).clearAndSetSemantics {})

        if (live.takenOver) {
            // The word in the eyebrow is the correction; this is why. Without it, a listener is
            // told a show is on while plainly hearing something else.
            Text(
                stringResource(R.string.schedule_taken_over),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun BetweenCard(between: OnNow.Between) {
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Heading(stringResource(R.string.schedule_between_blocks), "")
            Text(stringResource(R.string.schedule_nothing_scheduled), style = MaterialTheme.typography.titleMedium)
            Text(between.detail.resolve(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AheadCard(ahead: Ahead, artUrlFor: (String?) -> String?) {
    ExpandableCard(ahead.block) { expanded, onTruncated ->
        Heading(ahead.eyebrow.resolve(), ahead.startsIn.resolve())
        BlockBody(ahead.block, artUrlFor, expanded, onTruncated)
    }
}

/**
 * A block's card, which opens to the whole of its label and brief when either was cut short.
 *
 * Pressable only when there is more to read: a card that answered a tap by doing nothing would look
 * broken, and one that offered "Show more" over text already shown in full would be lying. Whether
 * anything was cut is what the collapsed layout reported, so it is remembered across the expanded
 * one, which by definition cuts nothing.
 */
@Composable
private fun ExpandableCard(block: BlockCard, content: @Composable (expanded: Boolean, onTruncated: (Boolean) -> Unit) -> Unit) {
    var expanded by rememberSaveable(block) { mutableStateOf(false) }
    var truncated by remember(block) { mutableStateOf(false) }
    val onTruncated: (Boolean) -> Unit = { if (!expanded) truncated = it }
    val label = stringResource(if (expanded) R.string.schedule_show_less else R.string.schedule_show_more)

    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .then(if (truncated || expanded) Modifier.clickable(onClickLabel = label, role = Role.Button) { expanded = !expanded } else Modifier)
                    .animateContentSize()
                    .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            content(expanded, onTruncated)
            if (truncated || expanded) {
                // The press's label already says it to a screen reader.
                Icon(
                    painterResource(if (expanded) R.drawable.ic_expand_less else R.drawable.ic_expand_more),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp).align(Alignment.CenterHorizontally),
                )
            }
        }
    }
}

@Composable
private fun Heading(eyebrow: String, trailing: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        // Small, medium weight and spaced, rather than shouted: `uppercase()` used the default
        // locale (a Turkish i becomes İ) and some screen readers spell a run of capitals out.
        Text(
            eyebrow,
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.08.em),
            color = MaterialTheme.colorScheme.primary,
        )
        if (trailing.isNotEmpty()) {
            Text(trailing, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun BlockBody(block: BlockCard, artUrlFor: (String?) -> String?, expanded: Boolean, onTruncated: (Boolean) -> Unit) {
    // Either line being cut makes the card worth opening, so each reports its own and they are or'd.
    var labelCut by remember(block) { mutableStateOf(false) }
    var briefCut by remember(block) { mutableStateOf(false) }
    val maxLines = if (expanded) Int.MAX_VALUE else 2

    Text(
        block.label.resolve(),
        style = MaterialTheme.typography.titleMedium,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        onTextLayout = {
            labelCut = it.hasVisualOverflow
            onTruncated(labelCut || briefCut)
        },
    )

    val hours = block.hours?.resolve()
    val line =
        when {
            hours == null -> block.host
            block.host == null -> hours
            else -> stringResource(R.string.schedule_hours_and_host, hours, block.host)
        }
    line?.let {
        // The host's face before the line that names them, small and round as on Now playing, so it
        // reads as a face beside a name rather than as the block's cover.
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            artUrlFor(block.hostPortraitPath)?.let { url ->
                AsyncImage(
                    model = url,
                    // The line beside it says who it is.
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(HostPortraitSize).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainer),
                )
            }
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    block.brief?.let {
        Text(
            it,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { layout ->
                briefCut = layout.hasVisualOverflow
                onTruncated(labelCut || briefCut)
            },
        )
    }
}

/** A host's face beside the line that names them: a little taller than the line, so a face is still a face. */
private val HostPortraitSize = 24.dp
