package com.maroonedsoftware.deadair.ui.text

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInputChartOrder
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.ui.catalog.EnrichmentField
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

    data object Untrusted : Message

    // ── The account ───────────────────────────────────────────────────────────────────────
    data object BadCredentials : Message

    data object CouldNotReachToSignIn : Message

    data object SecondFactorUnsupported : Message

    data object CodeRefused : Message

    data object SignInExpired : Message

    data object FactorRefused : Message

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

    // ── The operator's transport ──────────────────────────────────────────────────────────
    data object SchedulePutThisOn : Message

    data object BetweenBlocks : Message

    data object YouPutThisOn : Message

    data object ScheduleTakesThisBack : Message

    data object HeldUntilReleased : Message

    data class HeldUntilAbout(val clock: Clock) : Message

    /** What an action came back with, for a snackbar. */
    data class OperatorNotice(val notice: Notice) : Message

    // ── The running order ─────────────────────────────────────────────────────────────────
    /** "3 played earlier, 1 skipped", each clause only when there is one; neither is "Earlier in this broadcast". */
    data class FoldedHistory(val played: Int, val passed: Int) : Message

    /** Where a spent item got to, in the console's words. */
    data class ItemState(val state: StationItemState) : Message

    data object NotWrittenYet : Message

    data object NoAudioYet : Message

    data object WillSkip : Message

    // ── A record's page ───────────────────────────────────────────────────────────────────
    /** The label on one of the enrichment scalars. */
    data class Field(val field: EnrichmentField) : Message

    /** Who said it and when: "musicbrainz · 3 May · due again". */
    data class Provenance(val source: com.maroonedsoftware.deadair.ui.catalog.Provenance) : Message

    // ── Airing a chart ────────────────────────────────────────────────────────────────────
    data class ChartOrder(val order: PlayoutChartInputChartOrder) : Message

    // ── What it said ──────────────────────────────────────────────────────────────────────
    data class Outcome(val outcome: ScriptOutcome) : Message

    /** Who wrote a break, by the writer's own name. The two the station ships are named; any other is shown as it comes. */
    data class Writer(val writer: String) : Message

    data object FactKind : Message

    data object FactHost : Message

    data object FactModel : Message

    data object FactFrom : Message

    data object FactTook : Message

    data object FactTokens : Message

    data object FactAfter : Message

    data object FactBefore : Message

    data object FactNote : Message

    // ── The broadcast ─────────────────────────────────────────────────────────────────────
    /** Who presents this show, named. The name is the station's own word for one of its characters. */
    data class PresentedBy(val name: String) : Message

    /** The broadcast named nobody and the station's own host has not been read yet, so there is no name to give. */
    data object PresentedByStationsHost : Message

    /** The broadcast named nobody and the station has nobody on air either. */
    data object PresentedByNobody : Message

    /** What the operator asked this broadcast to play, in their own words. */
    data class AskedFor(val brief: String) : Message

    // ── Planning the station ──────────────────────────────────────────────────────────────
    /** How the station picks the records for a broadcast. */
    data class Mode(val mode: StationMode) : Message

    /** What happens when the running order runs out. */
    data class OnEnd(val onEnd: StationOnEnd) : Message

    data object EraOutOfRange : Message

    data object EraBackwards : Message

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
