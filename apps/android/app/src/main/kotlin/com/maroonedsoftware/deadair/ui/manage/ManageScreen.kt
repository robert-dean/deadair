package com.maroonedsoftware.deadair.ui.manage

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * One action on the Manage page: what it is called, a line under it when there is something worth
 * saying, and whether it can be pressed now. [opens] draws the chevron of a row that leads to another
 * page, which is how an action that happens here is told apart from one that goes somewhere.
 */
data class ManageAction(val title: String, val onClick: () -> Unit, val detail: String? = null, val enabled: Boolean = true, val opens: Boolean = false)

/** A titled group of actions. A group with nothing in it is not drawn. */
data class ManageGroup(val title: String, val actions: List<ManageAction>)

/**
 * The station's controls from Up next, in one place.
 *
 * They were four things in four places: a host chip and a Plan link over the list, an icon for what
 * the station said, and an overflow of verbs. Each is a row here, in a group that says what it acts
 * on, and each row says in words what it does.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManageScreen(groups: List<ManageGroup>, snackbarHost: SnackbarHostState, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.manage)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back)) }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(modifier = Modifier.widthIn(max = FormMaxWidth).fillMaxWidth().padding(bottom = 24.dp)) {
                groups.filter { it.actions.isNotEmpty() }.forEach { group ->
                    Text(
                        group.title.uppercase(),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = Gutter, end = Gutter, top = 20.dp, bottom = 4.dp).semantics { heading() },
                    )
                    group.actions.forEach { ActionRow(it) }
                }
            }
        }
    }
}

@Composable
private fun ActionRow(action: ManageAction) {
    val enabled = action.enabled
    ListItem(
        headlineContent = { Text(action.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = action.detail?.let { { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis) } },
        trailingContent = if (action.opens) ({ Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null) }) else null,
        modifier =
            Modifier.fillMaxWidth()
                .alpha(if (enabled) 1f else DISABLED_ALPHA)
                .clickable(enabled = enabled, role = Role.Button, onClick = action.onClick),
    )
}

/** How faint an action is while it cannot be pressed: still readable, so the page says what exists. */
private const val DISABLED_ALPHA = 0.45f
