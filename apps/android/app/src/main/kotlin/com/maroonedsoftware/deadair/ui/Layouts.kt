package com.maroonedsoftware.deadair.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * A column that is centred when its content fits and scrolls when it does not.
 *
 * The two do not come together for free: a scrolling column has no height to centre within, so
 * `Arrangement.Center` inside `verticalScroll` centres nothing. Giving the column a minimum height
 * of the viewport is what lets it be both — at ordinary text sizes it fills the screen and
 * centres, and at the largest accessibility font scale, or in landscape, it grows past the
 * viewport and scrolls rather than measuring its own play button out of existence.
 */
@Composable
fun CentredColumn(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier.fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = maxHeight)
                    .padding(horizontal = Gutter),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}
