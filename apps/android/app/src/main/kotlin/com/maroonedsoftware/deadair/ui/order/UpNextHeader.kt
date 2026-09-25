package com.maroonedsoftware.deadair.ui.order

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.nowplaying.CoverMesh
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The head of Up next: who is presenting, and the tab's one action beside it, over the on-air cover's
 * colours. There is no title: the tab bar already says where this is, and the heading pushed the
 * list down to say it again. Nor the station's name, which is the same on every tab.
 *
 * The host is the heading: their name, large, under a small label that says what it is. Where the
 * reader may change it, [onHost] makes the name the control, with the chevron a picker's field
 * carries, so the host is changed where it is read rather than two pages away.
 *
 * In place of an app bar, so the tab carries the same colour as Now playing and the heading can be
 * the size of one. The mesh stands STILL here, unlike Now playing's: this is a list somebody is
 * reading, and colour moving at the top of it pulls the eye off the rows. Its foot fades into the
 * page, so the list below starts on plain ground.
 */
@Composable
fun UpNextHeader(mesh: List<Int>, hostName: String?, onHost: (() -> Unit)?, actions: @Composable RowScope.() -> Unit, modifier: Modifier = Modifier) {
    val background = MaterialTheme.colorScheme.background
    Box(modifier = modifier.fillMaxWidth()) {
        CoverMesh(colors = mesh, moving = false, modifier = Modifier.matchParentSize().alpha(HEADER_MESH_STRENGTH))
        Box(modifier = Modifier.matchParentSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to background)))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(start = Gutter - HostInset, end = 4.dp, top = 12.dp, bottom = 8.dp),
        ) {
            Box(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                if (hostName != null) Host(hostName, onHost)
            }
            actions()
        }
    }
}

@Composable
private fun Host(name: String, onHost: (() -> Unit)?) {
    val changeHost = stringResource(R.string.change_host)
    Column(
        modifier =
            Modifier.clip(RoundedCornerShape(12.dp))
                .then(if (onHost != null) Modifier.clickable(onClickLabel = changeHost, role = Role.Button, onClick = onHost) else Modifier)
                .padding(horizontal = HostInset, vertical = 4.dp),
    ) {
        Text(stringResource(R.string.host_label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                name,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (onHost != null) {
                Icon(painterResource(R.drawable.ic_expand_more), contentDescription = null, modifier = Modifier.padding(start = 2.dp).size(24.dp))
            }
        }
    }
}

/** How far the host's pressed shape reaches past its words, so the words still line up with the rows under them. */
private val HostInset = 8.dp

/** How much of the mesh shows behind the heading: a tint, since the words over it are the point. */
private const val HEADER_MESH_STRENGTH = 0.7f
