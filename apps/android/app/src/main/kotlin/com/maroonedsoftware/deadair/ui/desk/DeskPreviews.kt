package com.maroonedsoftware.deadair.ui.desk

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.tooling.preview.PreviewLightDark
import com.maroonedsoftware.deadair.playout.PlayoutState
import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.sdk.models.AirSource
import com.maroonedsoftware.deadair.sdk.models.PlayoutItem
import com.maroonedsoftware.deadair.sdk.models.PlayoutNowPlaying
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.SilenceCheck
import com.maroonedsoftware.deadair.sdk.models.SilenceState
import com.maroonedsoftware.deadair.sdk.models.StationAir
import com.maroonedsoftware.deadair.sdk.models.StationSilence
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.nowplaying.TransportHandlers
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme

private val ruledOut =
    listOf(
        SilenceCheck(SilenceCause.STREAM_UNREACHABLE, SilenceState.OK, "held since 09:14"),
        SilenceCheck(SilenceCause.TRANSPORT_STALLED, SilenceState.OK, "running, 14 hours"),
        SilenceCheck(SilenceCause.NO_PROGRAMME, SilenceState.OK, "84 records ready"),
    )

private fun status(audible: Boolean, silence: StationSilence) =
    PlayoutStatus(
        streamUp = audible,
        onAir = audible,
        mountPath = "/live",
        mounts = emptyList(),
        nowPlaying =
            PlayoutNowPlaying(
                item = PlayoutItem(id = "i", pluginId = "p", externalId = "x", title = "Carriageway", artists = listOf("Pale Arcs")),
                startedAt = 0,
                remainingMs = 153_000,
            ),
        upNext = emptyList(),
        queuedCount = 0,
        listeners = if (audible) 9 else 0,
        audience = true,
        staleStreamConfig = emptyList(),
        silence = silence,
    )

private val onAir =
    PlayoutState.Loaded(
        status =
            status(
                audible = true,
                StationSilence(audible = true, cause = SilenceCause.AIRING, detail = "Icecast is holding the source, the encoder is running and the playlist has records in it.", checks = ruledOut),
            ),
        air = StationAir(active = true, airMode = AirMode.AUDIENCE, name = "Afternoon Drift", remaining = 4, airSource = AirSource.OPERATOR, held = false),
        stale = false,
    )

private val fault =
    PlayoutState.Loaded(
        status =
            status(
                audible = false,
                StationSilence(
                    audible = false,
                    cause = SilenceCause.CONTROL_DENIED,
                    detail = "The stream container has been retrying since 14:02. Its password does not match the one the station holds.",
                    remedy = "docker compose restart deadair-stream",
                    checks = listOf(SilenceCheck(SilenceCause.CONTROL_DENIED, SilenceState.FAULT, "Icecast refused the source")) + ruledOut.drop(1),
                ),
            ),
        air = StationAir(active = true, airMode = AirMode.AUDIENCE, name = "Afternoon Drift", remaining = 4, airSource = AirSource.SCHEDULE, held = false),
        stale = false,
    )

private val none = TransportHandlers(onSkip = {}, onStop = {}, onStart = {}, onHold = {}, onRelease = {}, onAirMode = {})

@Composable
private fun Framed(playout: PlayoutState) {
    DeadairTheme {
        DeskScreen(
            playout = playout,
            format = StreamFormat.MP3,
            artUrlFor = { null },
            busy = false,
            handlers = none,
            onBack = {},
            onRetry = {},
            onSignIn = {},
            snackbarHost = remember { SnackbarHostState() },
        )
    }
}

@PreviewLightDark
@Composable
private fun OnAirPreview() = Framed(onAir)

@PreviewLightDark
@Composable
private fun FaultPreview() = Framed(fault)

@PreviewLightDark
@Composable
private fun UnreachablePreview() = Framed(PlayoutState.Unreachable)
