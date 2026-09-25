package com.maroonedsoftware.deadair.ui.order

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.ui.nowplaying.CoverMesh
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The head of Up next: who is presenting, and the tab's one action beside it, over the on-air cover's
 * colours. There is no title: the tab bar already says where this is, and the heading pushed the
 * list down to say it again. Nor the station's name, which is the same on every tab.
 *
 * In place of an app bar, so the tab carries the same colour as Now playing and the heading can be
 * the size of one. The mesh stands STILL here, unlike Now playing's: this is a list somebody is
 * reading, and colour moving at the top of it pulls the eye off the rows. Its foot fades into the
 * page, so the list below starts on plain ground.
 */
@Composable
fun UpNextHeader(mesh: List<Int>, hostLine: String?, actions: @Composable RowScope.() -> Unit, modifier: Modifier = Modifier) {
    val background = MaterialTheme.colorScheme.background
    Box(modifier = modifier.fillMaxWidth()) {
        CoverMesh(colors = mesh, moving = false, modifier = Modifier.matchParentSize().alpha(HEADER_MESH_STRENGTH))
        Box(modifier = Modifier.matchParentSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to background)))
        Column(modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(start = Gutter, end = 4.dp, top = 16.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    hostLine.orEmpty(),
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(end = 8.dp),
                )
                actions()
            }
        }
    }
}

/** How much of the mesh shows behind the heading: a tint, since the words over it are the point. */
private const val HEADER_MESH_STRENGTH = 0.7f
