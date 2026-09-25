package com.maroonedsoftware.deadair.ui.manage

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.director.OrderState
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.ui.catalog.rememberDetail
import com.maroonedsoftware.deadair.ui.order.BroadcastUiState
import com.maroonedsoftware.deadair.ui.order.HostPicker
import com.maroonedsoftware.deadair.ui.order.OrderVerb
import com.maroonedsoftware.deadair.ui.order.orderMenu
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import kotlinx.coroutines.launch

/**
 * The Manage page, wired: the running order and the station's characters read here, and every
 * action taken through the same `OrderActions` Up next used.
 *
 * Which actions are offered, and when each can be pressed, is still `orderMenu`'s to say, so the
 * page and the rules it was built from cannot disagree. A signed-in listener who is not the operator
 * gets the one read they are allowed, What it said, and nothing that would be refused.
 */
@Composable
fun ManageRoute(
    graph: AppGraph,
    onBack: () -> Unit,
    /** Change what the station plays: this show from here on, or a new one. */
    onPlan: (currentBrief: String?, somethingOn: Boolean) -> Unit,
    onAirSomething: () -> Unit,
    onAddRecord: () -> Unit,
    /** What the station said between the records. */
    onScripts: () -> Unit,
) {
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true
    val order by graph.order.state.collectAsStateWithLifecycle()
    val loaded = (order as? OrderState.Loaded)?.order
    val personas = rememberDetail("personas") { graph.sessions.withSession { it.personas.listPersonas().personas } }
    val broadcast = loaded?.let { BroadcastUiState(it, (personas.state as? LoadState.Loaded)?.value) }

    // A notice raised here would be posted to nobody if only Up next collected them: it is not
    // composed while this page is on top of it.
    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    fun act(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                action()
            } finally {
                busy = false
            }
        }
    }

    var pickingHost by remember { mutableStateOf(false) }
    val refillAsked = stringResource(R.string.refill_asked)
    val menu = if (isOperator) orderMenu(loaded, busy) else emptyList()
    fun offered(verb: OrderVerb) = menu.firstOrNull { it.verb == verb }

    val show =
        buildList {
            if (broadcast != null && broadcast.canRecast && isOperator) {
                add(ManageAction(title = broadcast.hostMessage.resolve(), detail = stringResource(R.string.manage_host_detail), onClick = { pickingHost = true }, opens = true))
            }
            if (isOperator) {
                add(
                    ManageAction(
                        title = stringResource(R.string.manage_replan),
                        detail = broadcast?.brief?.let { Message.AskedFor(it).resolve() },
                        onClick = { onPlan(loaded?.brief, broadcast?.nothingOn == false) },
                        opens = true,
                    ),
                )
            }
            offered(OrderVerb.REFILL)?.let { item ->
                add(ManageAction(title = stringResource(R.string.menu_refill), enabled = item.enabled, onClick = { act { if (graph.orderActions.extend()) snackbarHost.showSnackbar(refillAsked) } }))
            }
            offered(OrderVerb.SHUFFLE)?.let { item ->
                add(ManageAction(title = stringResource(R.string.menu_shuffle), enabled = item.enabled, onClick = { act { graph.orderActions.shuffle() } }))
            }
        }
    val putOn =
        buildList {
            offered(OrderVerb.AIR_SOMETHING)?.let { add(ManageAction(title = stringResource(R.string.manage_air_something), onClick = onAirSomething, opens = true)) }
            offered(OrderVerb.ADD_RECORD)?.let { add(ManageAction(title = stringResource(R.string.manage_add_record), onClick = onAddRecord, opens = true)) }
        }
    val said =
        if (session is SessionState.SignedIn) {
            listOf(ManageAction(title = stringResource(R.string.what_it_said), detail = stringResource(R.string.manage_what_it_said_detail), onClick = onScripts, opens = true))
        } else {
            emptyList()
        }

    ManageScreen(
        groups =
            listOf(
                ManageGroup(stringResource(R.string.manage_this_show), show),
                ManageGroup(stringResource(R.string.manage_put_on), putOn),
                ManageGroup(stringResource(R.string.what_it_said), said),
            ),
        busy = busy,
        snackbarHost = snackbarHost,
        onBack = onBack,
    )

    if (pickingHost && broadcast != null) {
        HostPicker(
            choices = broadcast.hostChoices,
            stationsOwnEnabled = broadcast.stationsOwnEnabled,
            stationsOwnName = broadcast.stationsOwnName,
            selectedId = broadcast.order.personaId,
            note = R.string.host_picker_note,
            busy = busy,
            personas = personas.state,
            onRetry = personas::reload,
            onPick = { id ->
                pickingHost = false
                act { graph.orderActions.recast(id) }
            },
            onDismiss = { pickingHost = false },
        )
    }
}
