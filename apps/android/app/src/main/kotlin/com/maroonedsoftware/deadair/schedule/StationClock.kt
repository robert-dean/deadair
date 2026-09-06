package com.maroonedsoftware.deadair.schedule

import java.time.Duration
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Reading the station's clock, which is not this phone's.
 *
 * The API sends `YYYY-MM-DD HH:mm:ss` with no offset, deliberately: a block's ends are a READING of
 * the station's own clock rather than a moment in time, and attaching this device's timezone to one
 * would move a show that starts at eight to whatever eight o'clock means here. So every stamp is
 * parsed as a local date-time with no zone at all, displayed exactly as written, and the only
 * arithmetic done on it is the difference between two readings the station sent together.
 *
 * What that means at a clock change is worth being plain about, and it is the same thing the console
 * says: the answer is how much CLOCK is left, not how much time. On the night the clocks go back, a
 * block ending at two reads an hour shorter than it will run. That is the right answer for a screen
 * whose whole subject is what the station's clock says.
 */
private val STAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

/** A stamp as a zone-less date-time, or `null` for anything that is not one. */
fun readClock(stamp: String): LocalDateTime? =
    try {
        LocalDateTime.parse(stamp, STAMP)
    } catch (error: Exception) {
        null
    }

/** How many minutes apart two readings are. Zero when either is unreadable, which shows as "ending". */
fun minutesBetween(from: String, to: String): Long {
    val start = readClock(from) ?: return 0
    val end = readClock(to) ?: return 0
    return Duration.between(start, end).toMinutes()
}

/**
 * A number of minutes as a length somebody would say out loud.
 *
 * The unit gets coarser as the number gets bigger, which is the point of it: a block that runs once
 * a week is genuinely six days off, and "161 h" is a true answer nobody can read. Past a day the
 * minutes stop being information.
 */
fun formatSpan(minutes: Long): String {
    if (minutes <= 0) return "ending"
    if (minutes < MINUTES_PER_HOUR) return "$minutes min"

    if (minutes < MINUTES_PER_DAY) {
        val hours = minutes / MINUTES_PER_HOUR
        val rest = minutes % MINUTES_PER_HOUR
        return if (rest == 0L) "$hours h" else "$hours h $rest min"
    }

    val days = Math.round(minutes.toDouble() / MINUTES_PER_DAY)
    return if (days == 1L) "a day" else "$days days"
}

/**
 * A block's hours, with the weekday when it is not the one the station is having.
 *
 * The date is dropped rather than shown in full: these sit stacked and the useful difference between
 * them is the hour, not the year.
 */
fun formatHours(start: String, end: String, now: String): String {
    val from = readClock(start)
    val to = readClock(end)
    if (from == null || to == null) return ""

    val today = readClock(now)?.toLocalDate()
    val prefix = if (today != null && from.toLocalDate() != today) "${DAY_LABELS[from.dayOfWeek.value % 7]} " else ""
    return "$prefix${clockOf(from)}–${clockOf(to)}"
}

private fun clockOf(at: LocalDateTime): String = "%02d:%02d".format(at.hour, at.minute)

/** Sunday first, matching the API's own day numbering on a slot. */
private val DAY_LABELS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

private const val MINUTES_PER_HOUR = 60L
private const val MINUTES_PER_DAY = 24L * MINUTES_PER_HOUR
