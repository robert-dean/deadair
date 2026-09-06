package com.maroonedsoftware.deadair.ui.history

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * When a record aired, as a listener reads it.
 *
 * `airedAt` is a real instant — the moment the record started, sent as ISO-8601 — which makes this
 * the opposite case from the schedule's stamps. Those are readings of the STATION's clock and are
 * shown exactly as written; this one is a point in time, and the listener's own zone is the right
 * one to show it in. A phone in another country should read "21:14" as the time it was where they
 * were standing, not where the transmitter is.
 *
 * The unit gets coarser going back, for the same reason a span does: the useful thing about a
 * record played four minutes ago is the clock time, and the useful thing about one played on Monday
 * is that it was Monday.
 */
fun airedLabel(airedAtEpochMs: Long, nowEpochMs: Long, zone: ZoneId): String {
    val aired = Instant.ofEpochMilli(airedAtEpochMs).atZone(zone)
    val today = Instant.ofEpochMilli(nowEpochMs).atZone(zone).toLocalDate()
    val day: LocalDate = aired.toLocalDate()
    val clock = aired.format(CLOCK)

    return when {
        day == today -> clock
        day == today.minusDays(1) -> "Yesterday $clock"
        // Inside the last week a weekday still identifies the day; past that it stops being one.
        day.isAfter(today.minusDays(7)) -> "${day.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault())} $clock"
        else -> aired.format(DATE)
    }
}

private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM")
