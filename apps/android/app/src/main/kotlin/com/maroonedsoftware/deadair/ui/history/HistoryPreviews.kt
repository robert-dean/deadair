package com.maroonedsoftware.deadair.ui.history

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.tooling.preview.PreviewLightDark
import com.maroonedsoftware.deadair.history.HistoryState
import com.maroonedsoftware.deadair.sdk.models.HistoryEntry
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme
import kotlin.time.Instant

private val now = 1_800_000_000_000L

private fun entry(id: String, title: String, artists: String, minutesAgo: Long) =
    HistoryEntry(id = id, airedAt = Instant.fromEpochMilliseconds(now - minutesAgo * 60_000), title = title, artists = artists)

private val entries =
    listOf(
        entry("1", "Blue Monday", "New Order", 4),
        entry("2", "Always Something There to Remind Me", "Naked Eyes", 8),
        entry("3", "Cruel Summer", "Bananarama", 12),
    )

@Composable
private fun Framed(state: HistoryState) {
    DeadairTheme {
        Surface {
            HistoryScreen(state, artUrlFor = { null }, nowEpochMs = now, scope = rememberCoroutineScope(), onLoadMore = {}, onRetry = {}, onSettings = {}, onTrack = {})
        }
    }
}

@PreviewLightDark
@Composable
private fun LoadedPreview() = Framed(HistoryState.Loaded(entries, canLoadMore = true, loadingMore = false, stale = false, lastGoodAtMs = now))

@PreviewLightDark
@Composable
private fun StalePreview() = Framed(HistoryState.Loaded(entries, canLoadMore = false, loadingMore = false, stale = true, lastGoodAtMs = now - 300_000))

@PreviewLightDark
@Composable
private fun EmptyPreview() = Framed(HistoryState.Loaded(emptyList(), canLoadMore = false, loadingMore = false, stale = false))

@PreviewLightDark
@Composable
private fun SignedOutPreview() = Framed(HistoryState.SignedOut)

@PreviewLightDark
@Composable
private fun UnreachablePreview() = Framed(HistoryState.Unreachable)
