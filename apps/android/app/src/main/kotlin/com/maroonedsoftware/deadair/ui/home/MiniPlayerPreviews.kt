package com.maroonedsoftware.deadair.ui.home

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.PreviewLightDark
import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

// One preview per state the bar can be in, light and dark, for the reason `NowPlayingPreviews` gives.

private val track = NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", album = "Windowlicker", startedAt = 1)

private fun state(air: AirState, playing: Boolean = false, buffering: Boolean = false, stale: Boolean = false, show: NowPlayingShow? = null) =
    NowPlayingUiState(air = air, playing = playing, buffering = buffering, stale = stale, show = show)

@PreviewLightDark
@Composable
private fun OnAirPreview() = DeadairTheme { MiniPlayer(state(AirState.OnAir(track), playing = true), artworkUrl = null, onOpen = {}, onPlay = {}, onStop = {}) }

@PreviewLightDark
@Composable
private fun OnTheMicPreview() = DeadairTheme {
    val spoken = NowPlayingTrack(kind = NowPlayingTrackKind.BREAK, title = "Top of the hour", artist = "", startedAt = 1)
    MiniPlayer(state(AirState.OnAir(spoken), playing = true, show = NowPlayingShow(name = "Late Static", host = "Cass")), artworkUrl = null, onOpen = {}, onPlay = {}, onStop = {})
}

@PreviewLightDark
@Composable
private fun OffAirPreview() = DeadairTheme { MiniPlayer(state(AirState.OffAir), artworkUrl = null, onOpen = {}, onPlay = {}, onStop = {}) }

@PreviewLightDark
@Composable
private fun WarmingUpPreview() = DeadairTheme { MiniPlayer(state(AirState.WarmingUp, playing = true, buffering = true), artworkUrl = null, onOpen = {}, onPlay = {}, onStop = {}) }

@PreviewLightDark
@Composable
private fun StalePreview() = DeadairTheme { MiniPlayer(state(AirState.Unreachable, playing = true, stale = true), artworkUrl = null, onOpen = {}, onPlay = {}, onStop = {}) }
