package com.maroonedsoftware.deadair.ui.catalog

import com.maroonedsoftware.deadair.sdk.models.Rating

/**
 * Which segment the control draws pressed.
 *
 * An absent rating and an explicit `neutral` both draw as nothing pressed. Every record has an
 * implicit place in the rotation whether or not anybody stated one, but a list of never-rated
 * records showing the middle pressed on every row reads as hundreds of decisions somebody made.
 * Picking neutral on purpose lands on the same nothing, which is how withdrawing an opinion stays
 * reachable.
 */
fun ratingSelection(rating: Rating?): Rating? = rating?.takeIf { it != Rating.NEUTRAL }
