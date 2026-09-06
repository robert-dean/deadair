package com.maroonedsoftware.deadair.ui.text

import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.station.StreamFormat
import java.time.DayOfWeek
import java.time.LocalDate

/**
 * A thing the app says, before it is said in any language.
 *
 * The pure state classes — what the now-playing line reads, what the address field says back,
 * what a block is called — are kept free of `android.*` so their copy can be decided by a function
 * a JVM test can call. That was right, and it also meant every word lived in Kotlin and none in
 * `strings.xml`, so the app could not be translated without breaking the tests that guard it.
 *
 * This is the seam that keeps both. State returns a `Message`, which names WHAT is being said and
 * carries whatever it depends on; the tests assert on that value; and the resolver at the Compose
 * edge turns it into words through `stringResource`, where the plurals and the locale live. A
 * message the resolver does not know is a compile error, because its `when` is exhaustive — which
 * is what makes adding one without a string impossible rather than merely wrong.
 *
 * `Text` is the one member that carries words rather than naming them, and it is for words the
 * STATION sent: a title, a credit, a block's label. App copy never goes through it.
 */
sealed interface Message {
    /** Words the station sent, shown as they came. Never app copy. */
    data class Text(val value: String) : Message

    // ── Now playing ──────────────────────────────────────────────────────────────────────
    data object WarmingUp : Message

    data object OffAir : Message

    data object CantReachStation : Message

    data object QuietUntilSomeoneTunesIn : Message

    data object ComingOnAir : Message

    data object ShowingLastSaid : Message

    /** "N listening · MP3", with the count spelled the way the language counts. */
    data class Listeners(val count: Long, val format: StreamFormat) : Message

    data class FellBackToMp3(val wanted: StreamFormat) : Message

    // ── The address field ─────────────────────────────────────────────────────────────────
    data class AnsweredAs(val name: String) : Message

    data object NotEncrypted : Message

    data object NotAnAddress : Message

    data object UnknownShape : Message

    data class OlderApi(val missing: String) : Message

    data object NotAStation : Message

    data class AnsweredStatus(val status: Int) : Message

    data object CouldNotReach : Message

    // ── The account ───────────────────────────────────────────────────────────────────────
    data object BadCredentials : Message

    data object CouldNotReachToSignIn : Message

    data object SecondFactorUnsupported : Message

    data object NoRefreshToken : Message

    // ── The schedule ──────────────────────────────────────────────────────────────────────
    data object OnAir : Message

    data object DueNow : Message

    data object UpNext : Message

    data object AfterThat : Message

    data object Untitled : Message

    data class Left(val span: Span) : Message

    data class In(val span: Span) : Message

    data class SustainingFor(val span: Span) : Message

    data object NoBlockDue : Message

    /** A block's hours, with the weekday when it is not the station's own today. */
    data class BlockHours(val from: Clock, val to: Clock, val day: DayOfWeek?) : Message

    // ── History ───────────────────────────────────────────────────────────────────────────
    data class Aired(val label: AiredLabel) : Message

    // ── The transport ─────────────────────────────────────────────────────────────────────
    /** Two words per gate, for the lamp's caption. The station supplies the sentence. */
    data class SilenceLabel(val cause: SilenceCause) : Message

    /** A heading per gate, for the panel. */
    data class SilenceTitle(val cause: SilenceCause) : Message

    // ── A stale reading ───────────────────────────────────────────────────────────────────
    data object LastSaid : Message

    data class LastSaidAt(val clock: Clock) : Message
}

/**
 * A length of time as somebody would say it.
 *
 * The unit gets coarser as the number gets bigger, which is the point: a block that runs once a
 * week is genuinely six days off, and "161 h" is a true answer nobody can read.
 */
sealed interface Span {
    data object Ending : Span

    data class Minutes(val minutes: Long) : Span

    data class Hours(val hours: Long, val minutes: Long) : Span

    data object ADay : Span

    data class Days(val days: Long) : Span
}

/** A time of day, before it is written in the twelve-hour or twenty-four-hour form the phone prefers. */
data class Clock(val hour: Int, val minute: Int)

/** When a record aired, in the form that identifies it best from where the reader is standing. */
sealed interface AiredLabel {
    data class Today(val clock: Clock) : AiredLabel

    data class Yesterday(val clock: Clock) : AiredLabel

    data class Weekday(val day: DayOfWeek, val clock: Clock) : AiredLabel

    data class OnDate(val date: LocalDate) : AiredLabel
}
