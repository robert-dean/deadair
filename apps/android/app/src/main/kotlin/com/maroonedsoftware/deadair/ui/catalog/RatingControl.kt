package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.Rating

/**
 * What the station thinks of one record, artist or album: disliked, no opinion, liked.
 *
 * One question with three answers, so one segmented row rather than two toggles, and the middle is
 * a segment of its own because withdrawing an opinion is a choice an operator should be able to see.
 * Not a star scale: like and dislike are opposite poles, not one and two stars.
 *
 * `label` is what is being rated, for what each segment is CALLED to a screen reader ("Like X")
 * rather than drawn. A list of these is then a list of distinguishable controls.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RatingControl(rating: Rating?, label: String, busy: Boolean, onRate: (Rating) -> Unit, modifier: Modifier = Modifier) {
    val selected = ratingSelection(rating)
    SingleChoiceSegmentedButtonRow(modifier = modifier.fillMaxWidth()) {
        SEGMENTS.forEachIndexed { index, segment ->
            val name = stringResource(segment.name, label)
            SegmentedButton(
                selected = selected == segment.rating,
                onClick = { onRate(segment.rating) },
                enabled = !busy,
                shape = SegmentedButtonDefaults.itemShape(index = index, count = SEGMENTS.size),
                icon = {},
                modifier = Modifier.semantics { contentDescription = name },
            ) {
                Icon(painterResource(segment.icon), contentDescription = null, modifier = Modifier.size(20.dp))
            }
        }
    }
}

private class Segment(val rating: Rating, val icon: Int, val name: Int)

private val SEGMENTS =
    listOf(
        Segment(Rating.DISLIKED, R.drawable.ic_thumb_down, R.string.rating_dislike),
        Segment(Rating.NEUTRAL, R.drawable.ic_remove, R.string.rating_no_opinion),
        Segment(Rating.LIKED, R.drawable.ic_thumb_up, R.string.rating_like),
    )
