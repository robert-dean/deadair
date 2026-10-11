package com.maroonedsoftware.deadair.nowplaying

/**
 * When Now playing keeps the screen on.
 *
 * Never by default: a screen that will not sleep is a battery spent on a picture, and somebody who
 * wants the cover on the kitchen counter all evening can say so.
 */
enum class KeepAwake {
    /** The screen sleeps on the phone's own timeout, as in any other app. */
    NEVER,

    /** On while the phone is on power, which is the counter or the dashboard and costs nothing. */
    WHILE_CHARGING,

    /** On whatever the battery says. */
    ALWAYS,
}

/**
 * Whether the screen is held on right now.
 *
 * All of three things: the setting allows it (on power, for [KeepAwake.WHILE_CHARGING]), this phone
 * is playing, and Now playing is in front. Playing on another device is not enough, because then the
 * picture is a remote control rather than the radio, and a screen nobody can see is not worth a
 * battery. The setting is the cheapest test, so a phone left at Never decides on it alone.
 */
fun keepAwake(setting: KeepAwake, charging: Boolean, playing: Boolean, inFront: Boolean): Boolean {
    val allowed =
        when (setting) {
            KeepAwake.NEVER -> false
            KeepAwake.WHILE_CHARGING -> charging
            KeepAwake.ALWAYS -> true
        }
    return allowed && playing && inFront
}
