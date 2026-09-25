package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.sdk.models.Rating
import org.junit.Assert.assertEquals
import org.junit.Test

/** The heart is a way into and out of LIKED, over a rating that has three states. */
class LikeToggleTest {
    @Test
    fun `a liked record goes back to neutral`() {
        assertEquals(Rating.NEUTRAL, toggledLike(Rating.LIKED))
    }

    @Test
    fun `a neutral record is liked`() {
        assertEquals(Rating.LIKED, toggledLike(Rating.NEUTRAL))
    }

    @Test
    fun `a disliked record is liked, not merely forgiven`() {
        assertEquals(Rating.LIKED, toggledLike(Rating.DISLIKED))
    }

    @Test
    fun `a record whose rating has not been read yet is liked`() {
        assertEquals(Rating.LIKED, toggledLike(null))
    }
}
