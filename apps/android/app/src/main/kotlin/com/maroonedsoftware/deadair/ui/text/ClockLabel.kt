package com.maroonedsoftware.deadair.ui.text

import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * A time of day, written the way this phone writes them.
 *
 * Twenty-four-hour or twelve-hour is a setting on the phone, not a fact about the station, and
 * for an audience in the United States every time in the app read wrong until it was honoured.
 * Pure Kotlin — the flag is passed in rather than read from `android.text.format` — so the copy
 * tests can cover both spellings.
 */
fun clockLabel(clock: Clock, uses24Hour: Boolean, locale: Locale): String =
    LocalTime.of(clock.hour, clock.minute).format(DateTimeFormatter.ofPattern(if (uses24Hour) "HH:mm" else "h:mm a", locale))
