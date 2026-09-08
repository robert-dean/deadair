package com.maroonedsoftware.deadair.ui.theme

import androidx.compose.ui.unit.dp

/**
 * The one horizontal gutter every screen uses.
 *
 * Four screens had four: 32, 24, 24 and the list item's own 16. Switching tabs visibly moved the
 * left edge, which is the kind of small wrongness nobody reports and everybody notices. Sixteen,
 * because it is what a Material list row already uses and the history tab is a list of them.
 */
val Gutter = 16.dp

/**
 * The widest a form gets. Past this a text field runs the width of a tablet with nothing in it,
 * and a line of body copy stops being readable. Forms centre within it.
 */
val FormMaxWidth = 480.dp

/** The widest the cover art gets. A full-width square on a tablet is a poster, not a cover. */
val ArtworkMaxWidth = 360.dp
