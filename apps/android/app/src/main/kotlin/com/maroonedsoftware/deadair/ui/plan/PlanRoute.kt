package com.maroonedsoftware.deadair.ui.plan

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.sdk.models.StationMode
import com.maroonedsoftware.deadair.sdk.models.StationOnEnd
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.ui.catalog.rememberDetail
import kotlinx.coroutines.launch

/**
 * Planning the station, wired.
 *
 * The form is held here and survives process death field by field, because it is the one screen in
 * this app somebody types a paragraph into. A refusal keeps the screen open and says so in its own
 * snackbar: the flow keeps nothing for a Home that is not composed, so a notice posted after
 * popping would be a button that did nothing.
 */
@Composable
fun PlanRoute(graph: AppGraph, currentBrief: String?, somethingOn: Boolean, onBack: () -> Unit, onDone: () -> Unit) {
    var scope by rememberSaveable { mutableStateOf(if (somethingOn) PlanScope.KEEP else PlanScope.NEW) }
    // Seeded from the broadcast for Keep, because clearing it is then an obvious gesture and the
    // operator can see what is steering the refills. A new show opens empty: it mints a broadcast
    // rather than editing this one.
    var brief by rememberSaveable { mutableStateOf(currentBrief.orEmpty()) }
    var personaId by rememberSaveable { mutableStateOf<String?>(null) }
    var eraFrom by rememberSaveable { mutableStateOf("") }
    var eraTo by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf(StationMode.ROTATION) }
    var onEnd by rememberSaveable { mutableStateOf(StationOnEnd.EXTEND) }
    var callins by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    val personas = rememberDetail("personas") { graph.sessions.withSession { it.personas.listPersonas().personas } }
    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    val coroutines = rememberCoroutineScope()
    val state =
        PlanUiState(
            scope = scope,
            form = PlanForm(brief = brief, personaId = personaId, eraFrom = eraFrom, eraTo = eraTo, mode = mode, onEnd = onEnd, callins = callins),
            currentBrief = currentBrief,
            somethingOn = somethingOn,
        )

    PlanScreen(
        state = state,
        personas = personas.state,
        busy = busy,
        snackbarHost = snackbarHost,
        onScope = { scope = it },
        onForm = { form ->
            brief = form.brief
            personaId = form.personaId
            eraFrom = form.eraFrom
            eraTo = form.eraTo
            mode = form.mode
            onEnd = form.onEnd
            callins = form.callins
        },
        onReloadPersonas = personas::reload,
        onSubmit = {
            if (busy) return@PlanScreen
            busy = true
            coroutines.launch {
                try {
                    val done = if (state.keeping) graph.orderActions.replan(state.replanInput()) else graph.air.goOnAir(state.putOnAirInput())
                    if (done) onDone()
                } finally {
                    busy = false
                }
            }
        },
        onBack = onBack,
    )
}
