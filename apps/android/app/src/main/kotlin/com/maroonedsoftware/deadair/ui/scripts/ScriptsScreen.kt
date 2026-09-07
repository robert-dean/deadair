package com.maroonedsoftware.deadair.ui.scripts

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
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
import kotlinx.coroutines.launch

/** The operator's opinion of a break. `null` for anyone else. */
data class ScriptRatingHandler(val busyId: String?, val onRate: (attemptId: String, ScriptRating) -> Unit)

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
    onSettings: () -> Unit,
    rating: ScriptRatingHandler?,
    /** This page can rate, so it says what the station answered. */
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
                ScriptsState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.what_it_said), onSettings)
                ScriptsState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                ScriptsState.Unreachable -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
                is ScriptsState.Loaded ->
                    Refreshable(state = state, onRefresh = onRetry) {
                        if (state.attempts.isEmpty()) {
                            EmptyPlaceholder(stringResource(R.string.scripts_empty))
                        } else {
                            Rows(state, scope, onLoadMore, rating)
                        }
                    }
            }
        }
    }
}

@Composable
private fun Rows(state: ScriptsState.Loaded, scope: CoroutineScope, onLoadMore: suspend () -> Unit, rating: ScriptRatingHandler?) {
    val zone = remember { ZoneId.systemDefault() }
    val nowEpochMs by rememberNowEpochMs()

    Column(modifier = Modifier.fillMaxSize()) {
        if (state.stale) StaleBanner(state.lastGoodAtMs, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
            itemsIndexed(state.attempts, key = { _, attempt -> attempt.id }) { index, attempt ->
                AttemptRow(attempt, nowEpochMs, zone, rating)
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
private fun AttemptRow(attempt: ScriptAttempt, nowEpochMs: Long, zone: ZoneId, rating: ScriptRatingHandler?) {
    val ui = ScriptRowUiState(attempt)
    var open by rememberSaveable(attempt.id) { mutableStateOf(false) }
    val expands = stringResource(if (open) R.string.hide_details else R.string.show_details)

    Column(modifier = Modifier.fillMaxWidth().clickable(onClickLabel = expands) { open = !open }.padding(horizontal = Gutter, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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

@Composable
private fun Lamp(tone: ScriptTone) {
    val colour =
        when (tone) {
            ScriptTone.OK -> MaterialTheme.colorScheme.primary
            ScriptTone.STANDBY -> MaterialTheme.colorScheme.outline
            ScriptTone.FAULT -> MaterialTheme.colorScheme.error
        }
    Box(modifier = Modifier.size(8.dp).background(colour, CircleShape))
}
