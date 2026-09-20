package com.maroonedsoftware.deadair.widget

/**
 * When the home-screen widget shows what is on: while this phone is playing it, or whenever the
 * station is airing at all.
 *
 * The live wallpaper's choice, in the same words, because it is the same question asked of the same
 * listener — and the default is the same one, for the same measured reason: a surface that exists
 * for as long as the phone is on must not ask the station anything for as long as the phone is on.
 */
enum class WidgetFollows {
    /**
     * This phone. The widget asks the station nothing while you are not listening, which is most of
     * the day on most phones: no poll, no scheduled work, no line in the station's log.
     */
    THIS_PHONE,

    /**
     * The station. What is on air is on the home screen whoever is listening, refreshed slowly in
     * the background and on a tap, with the age of the reading shown beside it once it is old.
     */
    STATION,
}

/** How often the widget asks the station, under [WidgetFollows.STATION]. The floor WorkManager allows is 15 minutes; this is twice it. */
const val WIDGET_REFRESH_MINUTES = 30L

/**
 * How old a reading has to be before the widget says when it was taken.
 *
 * A record is three minutes, so anything older than two is no longer safely "what is playing" — and
 * a widget that says the wrong record with no hedge is worse than one that admits its age.
 */
const val WIDGET_STALE_MS = 120_000L
