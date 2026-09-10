package com.maroonedsoftware.deadair.ui.text

import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.intl.Locale as ComposeLocale
import androidx.compose.ui.res.stringResource
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInputChartOrder
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.ui.plan.ERA_YEARS
import com.maroonedsoftware.deadair.ui.catalog.EnrichmentField
import com.maroonedsoftware.deadair.ui.catalog.SourceState
import java.time.Instant as JavaInstant
import java.time.format.FormatStyle
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * Whether times are written in the twenty-four-hour form. Provided once at the root from the
 * phone's own setting, read wherever a `Clock` is resolved.
 */
val LocalUses24HourClock = staticCompositionLocalOf { true }

/** The words for a message, in the language and the clock the phone is set to. */
@Composable
@ReadOnlyComposable
fun Message.resolve(): String =
    when (this) {
        is Message.Text -> value
        Message.WarmingUp -> stringResource(R.string.now_warming_up)
        Message.OffAir -> stringResource(R.string.now_off_air)
        Message.CantReachStation -> stringResource(R.string.now_cant_reach)
        Message.QuietUntilSomeoneTunesIn -> stringResource(R.string.now_quiet_until_someone_tunes_in)
        Message.ComingOnAir -> stringResource(R.string.now_coming_on_air)
        Message.ShowingLastSaid -> stringResource(R.string.now_showing_last_said)
        is Message.Listeners -> {
            // Zero is its own sentence rather than a plural form: "0 listening" is true and reads
            // like a fault, and every language has a word for nobody.
            val people =
                if (count == 0L) stringResource(R.string.nobody_listening) else pluralStringResource(R.plurals.listening, count.toInt(), count)
            stringResource(R.string.now_footer, people, format.label)
        }
        is Message.FellBackToMp3 -> stringResource(R.string.now_fell_back_to_mp3, wanted.label)
        is Message.AnsweredAs -> stringResource(R.string.station_answered_as, name)
        Message.NotEncrypted -> stringResource(R.string.station_not_encrypted)
        Message.NotAnAddress -> stringResource(R.string.station_not_an_address)
        Message.UnknownShape -> stringResource(R.string.station_unknown_shape)
        is Message.OlderApi -> stringResource(R.string.station_older_api, missing)
        Message.NotAStation -> stringResource(R.string.station_not_a_station)
        is Message.AnsweredStatus -> stringResource(R.string.station_answered_status, status)
        Message.CouldNotReach -> stringResource(R.string.station_could_not_reach)
        Message.Untrusted -> stringResource(R.string.station_untrusted)
        Message.BadCredentials -> stringResource(R.string.account_bad_credentials)
        Message.CouldNotReachToSignIn -> stringResource(R.string.account_could_not_reach)
        Message.SecondFactorUnsupported -> stringResource(R.string.account_second_factor_unsupported)
        Message.CodeRefused -> stringResource(R.string.account_code_refused)
        Message.SignInExpired -> stringResource(R.string.account_sign_in_expired)
        Message.FactorRefused -> stringResource(R.string.account_factor_refused)
        Message.NoRefreshToken -> stringResource(R.string.account_no_refresh_token)
        Message.OnAir -> stringResource(R.string.schedule_on_air)
        Message.DueNow -> stringResource(R.string.schedule_due_now)
        Message.UpNext -> stringResource(R.string.schedule_up_next)
        Message.AfterThat -> stringResource(R.string.schedule_after_that)
        Message.Untitled -> stringResource(R.string.schedule_untitled)
        is Message.Left -> stringResource(R.string.schedule_left, span.resolve())
        is Message.In -> stringResource(R.string.schedule_in, span.resolve())
        is Message.SustainingFor -> stringResource(R.string.schedule_sustaining_for, span.resolve())
        Message.NoBlockDue -> stringResource(R.string.schedule_no_block_due)
        is Message.BlockHours ->
            if (day == null) {
                stringResource(R.string.schedule_hours, from.resolve(), to.resolve())
            } else {
                stringResource(R.string.schedule_hours_on_day, day.shortName(), from.resolve(), to.resolve())
            }
        is Message.Aired -> label.resolve()
        Message.LastSaid -> stringResource(R.string.stale_last_said)
        is Message.PresentedBy -> stringResource(R.string.presented_by, name)
        Message.PresentedByStationsHost -> stringResource(R.string.presented_by_stations_host)
        Message.PresentedByNobody -> stringResource(R.string.presented_by_nobody)
        is Message.AskedFor -> stringResource(R.string.asked_for, brief)
        is Message.Mode ->
            stringResource(
                when (mode) {
                    StationMode.ROTATION -> R.string.mode_rotation
                    StationMode.SETLIST -> R.string.mode_setlist
                    StationMode.FEATURE -> R.string.mode_feature
                },
            )
        is Message.OnEnd ->
            stringResource(
                when (onEnd) {
                    StationOnEnd.EXTEND -> R.string.on_end_extend
                    StationOnEnd.REPEAT -> R.string.on_end_repeat
                    StationOnEnd.STOP -> R.string.on_end_stop
                },
            )
        Message.EraOutOfRange -> stringResource(R.string.plan_era_out_of_range, ERA_YEARS.first, ERA_YEARS.last)
        Message.EraBackwards -> stringResource(R.string.plan_era_backwards)
        is Message.LastSaidAt -> stringResource(R.string.stale_last_said_at, clock.resolve())
        is Message.SilenceLabel ->
            stringResource(
                when (cause) {
                    SilenceCause.AIRING -> R.string.silence_label_airing
                    SilenceCause.TRANSPORT_STALLED -> R.string.silence_label_transport_stalled
                    SilenceCause.CONTROL_DENIED -> R.string.silence_label_control_denied
                    SilenceCause.STREAM_UNREACHABLE -> R.string.silence_label_stream_unreachable
                    SilenceCause.CONFIG_NOT_ADOPTED -> R.string.silence_label_config_not_adopted
                    SilenceCause.STOOD_DOWN -> R.string.silence_label_stood_down
                    SilenceCause.NO_PROGRAMME -> R.string.silence_label_no_programme
                    SilenceCause.WARMING_UP -> R.string.silence_label_warming_up
                    SilenceCause.WAITING_ON_AUDIO -> R.string.silence_label_waiting_on_audio
                    SilenceCause.NO_AUDIENCE -> R.string.silence_label_no_audience
                    SilenceCause.NOT_DRIVING -> R.string.silence_label_not_driving
                    SilenceCause.STARVED -> R.string.silence_label_starved
                },
            )
        Message.SchedulePutThisOn -> stringResource(R.string.driving_schedule)
        Message.BetweenBlocks -> stringResource(R.string.driving_sustaining)
        Message.YouPutThisOn -> stringResource(R.string.driving_operator)
        Message.ScheduleTakesThisBack -> stringResource(R.string.hold_offered)
        Message.HeldUntilReleased -> stringResource(R.string.hold_until_released)
        is Message.HeldUntilAbout -> stringResource(R.string.hold_until_about, clock.resolve())
        is Message.OperatorNotice ->
            when (val it = notice) {
                Notice.NoLongerOperator -> stringResource(R.string.notice_no_longer_operator)
                Notice.StepUpNeeded -> stringResource(R.string.notice_step_up_needed)
                Notice.NothingToResume -> stringResource(R.string.notice_nothing_to_resume)
                Notice.PlaylistEmpty -> stringResource(R.string.notice_playlist_empty)
                Notice.HostGone -> stringResource(R.string.notice_host_gone)
                Notice.CouldNotReach -> stringResource(R.string.notice_could_not_reach)
                is Notice.Failed -> stringResource(R.string.notice_failed, it.status)
            }
        is Message.FoldedHistory -> {
            val clauses =
                listOfNotNull(
                    played.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.played_earlier, it, it) },
                    passed.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.skipped_earlier, it, it) },
                )
            if (clauses.isEmpty()) stringResource(R.string.earlier_in_this_broadcast) else clauses.joinToString(stringResource(R.string.clause_separator))
        }
        is Message.ItemState ->
            stringResource(
                when (state) {
                    StationItemState.PLANNED -> R.string.item_planned
                    StationItemState.HANDED -> R.string.item_handed
                    StationItemState.AIRING -> R.string.item_airing
                    StationItemState.PLAYED -> R.string.item_played
                    StationItemState.SKIPPED -> R.string.item_skipped
                    StationItemState.UNAVAILABLE -> R.string.item_unavailable
                    StationItemState.REMOVED -> R.string.item_removed
                },
            )
        is Message.Field ->
            stringResource(
                when (field) {
                    EnrichmentField.RELEASED -> R.string.field_released
                    EnrichmentField.LABEL -> R.string.field_label
                    EnrichmentField.BPM -> R.string.field_bpm
                    EnrichmentField.KEY -> R.string.field_key
                    EnrichmentField.ISRC -> R.string.field_isrc
                },
            )
        is Message.Provenance -> {
            val locale = ComposeLocale.current.platformLocale
            val date =
                JavaInstant.ofEpochMilli(source.fetchedAt.toEpochMilliseconds())
                    .atZone(java.time.ZoneId.systemDefault())
                    .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
            val state =
                when (source.state) {
                    SourceState.FOUND -> date
                    SourceState.NOTHING_FOUND -> stringResource(R.string.source_nothing_found)
                    SourceState.COULD_NOT_ASK -> stringResource(R.string.source_could_not_ask)
                    SourceState.COULD_NOT_REASK -> stringResource(R.string.source_could_not_reask, date)
                }
            val line = stringResource(R.string.source_line, source.provider, state)
            if (source.stale) stringResource(R.string.source_line, line, stringResource(R.string.source_due_again)) else line
        }
        is Message.ChartOrder ->
            stringResource(
                when (order) {
                    PlayoutChartInputChartOrder.COUNTDOWN -> R.string.chart_order_countdown
                    PlayoutChartInputChartOrder.RANKED -> R.string.chart_order_ranked
                    PlayoutChartInputChartOrder.UNORDERED -> R.string.chart_order_unordered
                },
            )
        is Message.Outcome ->
            stringResource(
                when (outcome) {
                    ScriptOutcome.WRITTEN -> R.string.outcome_written
                    ScriptOutcome.DECLINED -> R.string.outcome_declined
                    ScriptOutcome.FAILED -> R.string.outcome_failed
                },
            )
        is Message.Writer ->
            when (writer) {
                "model" -> stringResource(R.string.writer_model)
                "deterministic" -> stringResource(R.string.writer_floor)
                else -> writer
            }
        Message.FactKind -> stringResource(R.string.fact_kind)
        Message.FactHost -> stringResource(R.string.fact_host)
        Message.FactModel -> stringResource(R.string.fact_model)
        Message.FactFrom -> stringResource(R.string.fact_from)
        Message.FactTook -> stringResource(R.string.fact_took)
        Message.FactTokens -> stringResource(R.string.fact_tokens)
        Message.FactAfter -> stringResource(R.string.fact_after)
        Message.FactBefore -> stringResource(R.string.fact_before)
        Message.FactNote -> stringResource(R.string.fact_note)
        Message.NotWrittenYet -> stringResource(R.string.item_not_written_yet)
        Message.NoAudioYet -> stringResource(R.string.item_no_audio_yet)
        Message.WillSkip -> stringResource(R.string.item_will_skip)
        is Message.SilenceTitle ->
            stringResource(
                when (cause) {
                    SilenceCause.AIRING -> R.string.silence_title_airing
                    SilenceCause.TRANSPORT_STALLED -> R.string.silence_title_transport_stalled
                    SilenceCause.CONTROL_DENIED -> R.string.silence_title_control_denied
                    SilenceCause.STREAM_UNREACHABLE -> R.string.silence_title_stream_unreachable
                    SilenceCause.CONFIG_NOT_ADOPTED -> R.string.silence_title_config_not_adopted
                    SilenceCause.STOOD_DOWN -> R.string.silence_title_stood_down
                    SilenceCause.NO_PROGRAMME -> R.string.silence_title_no_programme
                    SilenceCause.WARMING_UP -> R.string.silence_title_warming_up
                    SilenceCause.WAITING_ON_AUDIO -> R.string.silence_title_waiting_on_audio
                    SilenceCause.NO_AUDIENCE -> R.string.silence_title_no_audience
                    SilenceCause.NOT_DRIVING -> R.string.silence_title_not_driving
                    SilenceCause.STARVED -> R.string.silence_title_starved
                },
            )
    }

@Composable
@ReadOnlyComposable
fun Span.resolve(): String =
    when (this) {
        Span.Ending -> stringResource(R.string.span_ending)
        is Span.Minutes -> pluralStringResource(R.plurals.span_minutes, minutes.toInt(), minutes)
        is Span.Hours ->
            if (minutes == 0L) {
                pluralStringResource(R.plurals.span_hours, hours.toInt(), hours)
            } else {
                pluralStringResource(R.plurals.span_hours_minutes, hours.toInt(), hours, minutes)
            }
        Span.ADay -> stringResource(R.string.span_a_day)
        is Span.Days -> pluralStringResource(R.plurals.span_days, days.toInt(), days)
    }

@Composable
@ReadOnlyComposable
fun Clock.resolve(): String = clockLabel(this, LocalUses24HourClock.current, currentLocale())

@Composable
@ReadOnlyComposable
fun AiredLabel.resolve(): String =
    when (this) {
        is AiredLabel.Today -> clock.resolve()
        is AiredLabel.Yesterday -> stringResource(R.string.history_yesterday_at, clock.resolve())
        is AiredLabel.Weekday -> stringResource(R.string.history_weekday_at, day.shortName(), clock.resolve())
        is AiredLabel.OnDate -> date.shortDate()
    }

@Composable
@ReadOnlyComposable
private fun DayOfWeek.shortName(): String = getDisplayName(TextStyle.SHORT, currentLocale())

/** Day and month in the order this locale writes them, which is not the order English does. */
@Composable
@ReadOnlyComposable
private fun LocalDate.shortDate(): String {
    val locale = currentLocale()
    return format(DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "d MMM"), locale))
}

/**
 * The locale Compose is observing, as `java.time` wants it. Not `Locale.getDefault()`: that is not
 * something recomposition can watch, so a language change under a running screen would leave the
 * dates in the old one until something else redrew them.
 */
@Composable
@ReadOnlyComposable
private fun currentLocale(): Locale = ComposeLocale.current.platformLocale
