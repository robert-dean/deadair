package com.maroonedsoftware.deadair.ui.scripts

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
import com.maroonedsoftware.deadair.sdk.models.ScriptRating

/**
 * What the operator thought of something the station said.
 *
 * The catalog control's mechanics and deliberately not that control: its words are claims about
 * rotation, and nothing acts on a script rating at all. Here an unrated attempt shows nothing
 * pressed and a neutral one shows the middle, because "heard it, no opinion" is a thing somebody
 * said and "nobody has listened yet" is not.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScriptRatingControl(rating: ScriptRating?, busy: Boolean, onRate: (ScriptRating) -> Unit, modifier: Modifier = Modifier) {
    SingleChoiceSegmentedButtonRow(modifier = modifier) {
        SEGMENTS.forEachIndexed { index, segment ->
            val name = stringResource(segment.name)
            SegmentedButton(
                selected = rating == segment.rating,
                onClick = { onRate(segment.rating) },
                enabled = !busy,
                shape = SegmentedButtonDefaults.itemShape(index = index, count = SEGMENTS.size),
                icon = {},
                modifier = Modifier.semantics { contentDescription = name },
            ) {
                Icon(painterResource(segment.icon), contentDescription = null, modifier = Modifier.size(18.dp))
            }
        }
    }
}

private class Segment(val rating: ScriptRating, val icon: Int, val name: Int)

private val SEGMENTS =
    listOf(
        Segment(ScriptRating.DISLIKED, R.drawable.ic_thumb_down, R.string.script_dislike),
        Segment(ScriptRating.NEUTRAL, R.drawable.ic_remove, R.string.script_no_opinion),
        Segment(ScriptRating.LIKED, R.drawable.ic_thumb_up, R.string.script_like),
    )
