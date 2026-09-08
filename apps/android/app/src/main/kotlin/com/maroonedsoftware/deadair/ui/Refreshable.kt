package com.maroonedsoftware.deadair.ui

import androidx.compose.foundation.layout.BoxScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.delay

/**
 * Pull to refresh, over a poll.
 *
 * The gesture every polled list on Android answers to, and it doubles as the retry a listener needs
 * when the poll has backed off. What it does is kick the repository; what it shows is a spinner
 * that ends when the next reading lands, or after a moment and a half if nothing does — because a
 * spinner that waited for a station that is down would spin for as long as the backoff.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Refreshable(
    /** Whatever the screen draws from. Any new value ends the spinner. */
    state: Any?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(state) { refreshing = false }
    LaunchedEffect(refreshing) {
        if (refreshing) {
            delay(SPINNER_CAP_MS)
            refreshing = false
        }
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            onRefresh()
        },
        modifier = modifier,
        content = content,
    )
}

private const val SPINNER_CAP_MS = 1_500L
