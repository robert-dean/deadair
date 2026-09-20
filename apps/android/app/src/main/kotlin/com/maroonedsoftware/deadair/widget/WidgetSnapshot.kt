package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind

/**
 * What the station was doing when this phone last heard from it.
 *
 * A widget is not a process. Whatever the launcher is showing was drawn by a process that may be
 * long gone, and the next draw happens when Android says so rather than when the station moves. So
 * the widget draws from a snapshot on disk, and everything else here exists to keep that snapshot
 * honest about its own age.
 *
 * Deliberately smaller than the reading it comes from: no mounts, no listener count, no playhead.
 * A widget shows none of them, and what is written to disk is what `PRIVACY.md` has to account for.
 */
data class WidgetSnapshot(
    /** What the station calls itself, which is drawn before any reading has arrived and while it is unreachable. */
    val stationName: String? = null,
    val onAir: Boolean = false,
    /** False once a poll has failed. The last good fields are kept, exactly as `NowPlayingState.Unreachable` keeps them. */
    val reachable: Boolean = true,
    val kind: NowPlayingTrackKind? = null,
    val title: String? = null,
    val artist: String? = null,
    /** Who is talking, when the station is talking. Absent for a record, and for an unnamed host. */
    val host: String? = null,
    val artworkUrl: String? = null,
    /** Wall-clock, because the age of this is shown to a person and has to survive a reboot. */
    val readAtMs: Long = 0L,
)

/**
 * The snapshot a reading makes, given what the settings call the station.
 *
 * Only ever built from an answer. A poll that FAILED does not come through here: the last good
 * fields are kept and only `reachable` is turned over, because blanking the widget for one failed
 * request would make every hiccup look like the station going away, and because the age shown
 * beside it is the age of the last thing the station actually said.
 */
fun snapshotOf(now: NowPlaying, stationName: String?, readAtMs: Long): WidgetSnapshot {
    val track = now.track
    return WidgetSnapshot(
        // The station's own name wins over the one the setup screen kept: it is the newer answer.
        stationName = now.station.ifBlank { null } ?: stationName,
        onAir = now.onAir,
        reachable = true,
        kind = track?.kind,
        title = track?.title,
        artist = track?.artist?.ifBlank { null },
        host = now.show?.host?.ifBlank { null },
        artworkUrl = track?.artworkUrl,
        readAtMs = readAtMs,
    )
}

/**
 * Whether a new snapshot is worth a disk write and a redraw.
 *
 * The poll answers every three seconds, and a widget that rewrote its file each time would be a
 * write every three seconds for a picture nobody may be looking at. Only what is DRAWN counts, so
 * a moved listener count changes nothing — which leaves the age, and the age is shown to the
 * nearest minute, so it earns a write once a minute at most.
 */
fun worthDrawing(last: WidgetSnapshot, next: WidgetSnapshot, ageGapMs: Long = AGE_GAP_MS): Boolean =
    last.copy(readAtMs = 0) != next.copy(readAtMs = 0) || next.readAtMs - last.readAtMs >= ageGapMs

/** How stale the kept age may get before it is rewritten for its own sake. The label it feeds is in minutes. */
const val AGE_GAP_MS = 60_000L
