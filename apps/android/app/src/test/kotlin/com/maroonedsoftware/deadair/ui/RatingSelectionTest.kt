package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.ui.catalog.ratingSelection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RatingSelectionTest {
    @Test
    fun `no opinion draws as nothing pressed, whether absent or stated`() {
        assertNull(ratingSelection(null))
        assertNull(ratingSelection(Rating.NEUTRAL))
    }

    @Test
    fun `an opinion draws as itself`() {
        assertEquals(Rating.LIKED, ratingSelection(Rating.LIKED))
        assertEquals(Rating.DISLIKED, ratingSelection(Rating.DISLIKED))
    }
}
