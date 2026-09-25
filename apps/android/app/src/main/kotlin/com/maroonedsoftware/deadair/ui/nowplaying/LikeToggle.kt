package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.sdk.models.Rating

/**
 * What pressing the heart on Now playing marks the record as.
 *
 * A heart has two states and a rating has three, so the heart is a way into and out of LIKED and
 * nothing else: pressed on a liked record it goes back to neutral, and pressed on anything else,
 * a record the operator had disliked included, it likes it. Disliking stays on the record's page,
 * where the three are laid out side by side and a thumb cannot reach one meaning the other.
 */
fun toggledLike(current: Rating?): Rating = if (current == Rating.LIKED) Rating.NEUTRAL else Rating.LIKED
