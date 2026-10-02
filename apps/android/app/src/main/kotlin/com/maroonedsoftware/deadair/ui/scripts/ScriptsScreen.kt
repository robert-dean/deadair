package com.maroonedsoftware.deadair.ui.scripts

import androidx.compose.animation.AnimatedVisibility
import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.scripts.BreakShare
import com.maroonedsoftware.deadair.scripts.ScriptsState
import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptRating
import com.maroonedsoftware.deadair.ui.EmptyPlaceholder
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.Refreshable
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.history.airedLabel
import com.maroonedsoftware.deadair.ui.rememberNowEpochMs
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The operator's opinion of a break. `null` for anyone else. */
data class ScriptRatingHandler(val busyId: String?, val onRate: (attemptId: String, ScriptRating) -> Unit)

/** Sending a break on. For anyone signed in; `busyId` is the row whose copy is being fetched. */
data class BreakShareHandler(val busyId: String?, val onShare: (ScriptAttempt) -> Unit)

/**
 * What the station said between the records, newest first, and what came of trying.
 *
 * A row is when, a lamp for how the attempt came out, who wrote it, and the words in two lines; a
 * tap opens everything else about it. Nothing here explains the writer's decisions: the reason it
 * gives is the station's own sentence, shown as it came.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScriptsScreen(
    oneBreak: Boolean,
    state: ScriptsState,
    scope: CoroutineScope,
    onBack: () -> Unit,
    onLoadMore: suspend () -> Unit,
    onRetry: () -> Unit,
    onSignIn: () -> Unit,
    rating: ScriptRatingHandler?,
    sharing: BreakShareHandler?,
    /** This page can rate and share, so it says what the station answered. */
    snackbarHost: SnackbarHostState,
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHost) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (oneBreak) R.string.one_break else R.string.what_it_said)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (state) {
                ScriptsState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.what_it_said), onSignIn)
                ScriptsState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                ScriptsState.Unreachable -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
                is ScriptsState.Loaded ->
                    Refreshable(state = state, onRefresh = onRetry) {
                        if (state.attempts.isEmpty()) {
                            EmptyPlaceholder(stringResource(R.string.scripts_empty))
                        } else {
                            Rows(state, scope, onLoadMore, rating, sharing)
                        }
                    }
            }
        }
    }
}

@Composable
private fun Rows(
    state: ScriptsState.Loaded,
    scope: CoroutineScope,
    onLoadMore: suspend () -> Unit,
    rating: ScriptRatingHandler?,
    sharing: BreakShareHandler?,
) {
    val zone = remember { ZoneId.systemDefault() }
    val nowEpochMs by rememberNowEpochMs()

    Column(modifier = Modifier.fillMaxSize()) {
        if (state.stale) StaleBanner(state.lastGoodAtMs, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
            itemsIndexed(state.attempts, key = { _, attempt -> attempt.id }) { index, attempt ->
                AttemptRow(attempt, nowEpochMs, zone, rating, sharing)
                if (index < state.attempts.lastIndex) HorizontalDivider()
            }
            if (state.canLoadMore) {
                item {
                    if (state.loadingMore) {
                        Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    } else {
                        TextButton(onClick = { scope.launch { onLoadMore() } }, modifier = Modifier.fillMaxWidth().padding(8.dp)) {
                            Text(stringResource(R.string.earlier))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttemptRow(attempt: ScriptAttempt, nowEpochMs: Long, zone: ZoneId, rating: ScriptRatingHandler?, sharing: BreakShareHandler?) {
    val ui = ScriptRowUiState(attempt)
    var open by rememberSaveable(attempt.id) { mutableStateOf(false) }
    val expands = stringResource(if (open) R.string.hide_details else R.string.show_details)

    Column(modifier = Modifier.fillMaxWidth().clickable(onClickLabel = expands) { open = !open }.padding(horizontal = Gutter, vertical = 12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                Message.Aired(airedLabel(attempt.at.toEpochMilliseconds(), nowEpochMs, zone)).resolve(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Lamp(ui.tone)
            Text(Message.Outcome(attempt.outcome).resolve(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.extraSmall) {
                Text(ui.writer.resolve(), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
            }
            Spacer(modifier = Modifier.weight(1f))
            // The words, wherever there are some, whether or not they ever became audio.
            ui.copyText?.let { words -> CopyButton(words) }
            // Only where there is audio to send: words were written and the segment is still known.
            if (sharing != null && BreakShare.shareable(attempt)) {
                ShareButton(busy = sharing.busyId == attempt.id, enabled = sharing.busyId == null) { sharing.onShare(attempt) }
            }
        }
        Text(
            ui.line,
            style = MaterialTheme.typography.bodyMedium,
            color = if (ui.lineIsReason) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            maxLines = if (open) Int.MAX_VALUE else 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp),
        )

        // Asked only where there are words to have an opinion about.
        if (rating != null && ui.rateable) {
            ScriptRatingControl(
                rating = ui.rating,
                busy = rating.busyId == attempt.id,
                onRate = { rating.onRate(attempt.id, it) },
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        AnimatedVisibility(visible = open) {
            Column(modifier = Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ui.facts.forEach { fact ->
                    Column {
                        Text(fact.label.resolve(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(fact.value, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

/**
 * The row's copy button, which puts the words on the clipboard and shows a tick for a moment.
 *
 * The tick rather than a snackbar: Android 13 and later announce a copy themselves, and a second
 * confirmation over the system's would say the same thing twice. On older phones the tick is all
 * there is, which is why it is there at all.
 */
@Composable
private fun CopyButton(words: String) {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember(words) { mutableStateOf(false) }
    if (copied) {
        LaunchedEffect(Unit) {
            delay(COPIED_TICK_MS)
            copied = false
        }
    }

    IconButton(
        onClick = {
            scope.launch {
                clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("what it said", words)))
                copied = true
            }
        },
        modifier = Modifier.size(32.dp),
    ) {
        Icon(
            painterResource(if (copied) R.drawable.ic_check else R.drawable.ic_content_copy),
            contentDescription = (if (copied) Message.CopiedWhatItSaid else Message.CopyWhatItSaid).resolve(),
            modifier = Modifier.size(18.dp),
        )
    }
}

/** How long the copy button shows its tick before it can be read as a copy button again. */
private const val COPIED_TICK_MS = 1_500L

/** The row's share button, or a spinner in its place while the station makes the copy. */
@Composable
private fun ShareButton(busy: Boolean, enabled: Boolean, onClick: () -> Unit) {
    // A fixed box, so the row does not reflow when the button turns into a spinner and back.
    Box(modifier = Modifier.size(32.dp), contentAlignment = Alignment.Center) {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        } else {
            IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(32.dp)) {
                Icon(painterResource(R.drawable.ic_share), contentDescription = Message.ShareBreak.resolve(), modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun Lamp(tone: ScriptTone) {
    val color =
        when (tone) {
            ScriptTone.OK -> MaterialTheme.colorScheme.primary
            ScriptTone.STANDBY -> MaterialTheme.colorScheme.outline
            ScriptTone.FAULT -> MaterialTheme.colorScheme.error
        }
    Box(modifier = Modifier.size(8.dp).background(color, CircleShape))
}
