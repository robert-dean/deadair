package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.SilenceCheck
import com.maroonedsoftware.deadair.sdk.models.SilenceState
import com.maroonedsoftware.deadair.sdk.models.StationSilence
import com.maroonedsoftware.deadair.ui.text.Message

/** What colour the reading is drawn in. Only `LIVE` means audio is leaving the building. */
enum class SilenceTone { LIVE, STANDBY, OFF, FAULT }

/** What would clear a gate. A shell command is shown as one and offered to copy; anything else is a sentence. */
data class Remedy(val text: String) {
    val isCommand: Boolean get() = text.startsWith("docker ")
}

/**
 * Why the station can or cannot be heard, as the phone draws it.
 *
 * The console's reading, carried over whole: nothing here works the answer out. The station
 * composes every gate and names its own cause, and this turns that cause into a tone, a label and
 * a title, and sorts the checks into the one that is blocking, the faults it is not blaming, and
 * everything it ruled out — which is the part worth opening the panel for.
 */
data class SilenceReading(
    val tone: SilenceTone,
    val label: Message,
    val title: Message,
    /** The station's own sentence. Never rewritten. */
    val detail: String,
    val remedy: Remedy?,
    /** Faults the station is not blaming, which still want saying. */
    val otherFaults: List<SilenceCheck>,
    /** Every gate that passed. */
    val ruledOut: List<SilenceCheck>,
) {
    val live: Boolean get() = tone == SilenceTone.LIVE
}

fun readSilence(silence: StationSilence): SilenceReading {
    val blocking = silence.checks.firstOrNull { it.code == silence.cause }
    val tone =
        when {
            silence.audible -> SilenceTone.LIVE
            blocking?.state == SilenceState.WAITING -> WAITING_TONES[silence.cause] ?: SilenceTone.STANDBY
            else -> SilenceTone.FAULT
        }
    val cause = if (silence.audible) SilenceCause.AIRING else silence.cause

    return SilenceReading(
        tone = tone,
        label = Message.SilenceLabel(cause),
        title = Message.SilenceTitle(cause),
        detail = silence.detail,
        remedy = silence.remedy?.let(::Remedy),
        otherFaults = silence.checks.filter { it.state == SilenceState.FAULT && it.code != silence.cause },
        ruledOut = silence.checks.filter { it.state == SilenceState.OK },
    )
}

/**
 * The waiting states that are not faults and must not be drawn as one.
 *
 * Standby for waiting on a listener, the resting state of an audience-gated station. Off for stood
 * down, because somebody did it on purpose. Partial on purpose: anything else the station calls
 * `waiting` is standby without this file having to hear about it.
 */
private val WAITING_TONES =
    mapOf(
        SilenceCause.NO_AUDIENCE to SilenceTone.STANDBY,
        SilenceCause.STOOD_DOWN to SilenceTone.OFF,
    )
