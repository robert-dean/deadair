package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.foundation.background
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R

/**
 * The station's one button: play, or stop, with a spinner in its place while the station warms up.
 *
 * One composable for Now playing and the player bar, so the two cannot drift. The name lives on the
 * button, not on the icon inside it: while the station warms up the icon is swapped for a spinner,
 * and a name that went with the icon left TalkBack announcing an unlabelled button that was still a
 * live stop control, for as long as a warm-up takes, which on an audience-gated station is every
 * time.
 */
@Composable
fun PlayStopButton(
    playing: Boolean,
    buffering: Boolean,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 72.dp,
    iconSize: Dp = 32.dp,
    /**
     * Drawn lit: a gradient fill and a glow of its own colour under it, for Now playing, where it is
     * the one control that everything else on the screen is arranged around. The player bar keeps
     * the flat one, because a glow on a 44dp button in a strip of chrome is a smudge.
     */
    glow: Boolean = false,
) {
    // Named by what it stops: this phone, not the station. The station's own stop is on the desk
    // and is called Take off air; both were "Stop" to TalkBack.
    val label = stringResource(if (playing) R.string.stop_listening else R.string.play)
    val bufferingLabel = stringResource(R.string.buffering)
    val fill = MaterialTheme.colorScheme.primary
    val lit =
        if (glow) {
            Modifier.shadow(elevation = 24.dp, shape = CircleShape, ambientColor = fill, spotColor = fill)
                .background(Brush.linearGradient(listOf(lerp(fill, Color.White, 0.25f), fill)), CircleShape)
        } else {
            Modifier
        }
    FilledIconButton(
        onClick = if (playing) onStop else onPlay,
        // Round, which is what a radio's one button is. The default shape is a rounded square.
        shape = CircleShape,
        // Lit, the gradient under it is the fill, so its own container stands aside.
        // Its content colour named outright: taken from a transparent container it was the page's
        // text colour, a pale icon on a pale button.
        colors =
            if (glow) {
                IconButtonDefaults.filledIconButtonColors(containerColor = Color.Transparent, contentColor = MaterialTheme.colorScheme.onPrimary)
            } else {
                IconButtonDefaults.filledIconButtonColors()
            },
        modifier =
            modifier.size(size).then(lit).semantics {
                contentDescription = label
                if (buffering) stateDescription = bufferingLabel
            },
    ) {
        if (buffering) {
            // In the button's content color, as the icon is: the indicator's own default is the
            // primary color, which is this button's fill, so the spinner was drawn and never seen.
            CircularProgressIndicator(
                modifier = Modifier.size(iconSize * 7 / 8),
                strokeWidth = if (size > 48.dp) 3.dp else 2.dp,
                color = LocalContentColor.current,
            )
        } else {
            Icon(painterResource(if (playing) R.drawable.ic_stop else R.drawable.ic_play), contentDescription = null, modifier = Modifier.size(iconSize))
        }
    }
}
