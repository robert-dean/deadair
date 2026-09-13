package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.PreviewLightDark
import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.nowplaying.Playhead
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

// One preview per state the screen can be in, light and dark. These exist because the copy and
// the layout are what a reviewer reads, and a state that only appears when a station is down is
// otherwise seen the first time it happens to somebody.

private val track = NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", album = "Windowlicker", durationMs = 366_000, startedAt = 1)

private val show = NowPlayingShow(name = "Late Static", host = "Cass")

private fun state(
    air: AirState,
    playing: Boolean = false,
    buffering: Boolean = false,
    stale: Boolean = false,
    fellBack: Boolean = false,
    show: NowPlayingShow? = null,
) = NowPlayingUiState(air = air, listeners = 3, format = StreamFormat.HLS, playing = playing, buffering = buffering, fellBackToMp3 = fellBack, stale = stale, show = show)

@Composable
private fun Framed(content: @Composable () -> Unit) {
    DeadairTheme { Surface { content() } }
}

@PreviewLightDark
@Composable
private fun OnAirPreview() = Framed {
    NowPlayingScreen(state(AirState.OnAir(track), playing = true), artworkUrl = null, playhead = Playhead(102_000, 264_000, 366_000), onPlay = {}, onStop = {}, onOpenFormat = {})
}

@PreviewLightDark
@Composable
private fun InAShowPreview() = Framed {
    NowPlayingScreen(state(AirState.OnAir(track), playing = true, show = show), artworkUrl = null, playhead = Playhead(102_000, 264_000, 366_000), onPlay = {}, onStop = {}, onOpenFormat = {})
}

@PreviewLightDark
@Composable
private fun OnTheMicPreview() = Framed {
    val spoken = NowPlayingTrack(kind = NowPlayingTrackKind.BREAK, title = "Top of the hour", artist = "", durationMs = 12_000, startedAt = 1)
    NowPlayingScreen(state(AirState.OnAir(spoken), playing = true, show = show), artworkUrl = null, playhead = Playhead(4_000, 8_000, 12_000), onPlay = {}, onStop = {}, onOpenFormat = {})
}

@PreviewLightDark
@Composable
private fun OffAirPreview() = Framed {
    NowPlayingScreen(state(AirState.OffAir), artworkUrl = null, playhead = null, onPlay = {}, onStop = {}, onOpenFormat = {})
}

@PreviewLightDark
@Composable
private fun WarmingUpPreview() = Framed {
    NowPlayingScreen(state(AirState.WarmingUp, playing = true, buffering = true), artworkUrl = null, playhead = null, onPlay = {}, onStop = {}, onOpenFormat = {})
}

@PreviewLightDark
@Composable
private fun StaleWithFallbackPreview() = Framed {
    NowPlayingScreen(state(AirState.Unreachable, playing = true, stale = true, fellBack = true), artworkUrl = null, playhead = null, onPlay = {}, onStop = {}, onOpenFormat = {})
}
