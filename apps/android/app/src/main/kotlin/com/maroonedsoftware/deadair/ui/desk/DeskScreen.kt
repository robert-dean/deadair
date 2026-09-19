package com.maroonedsoftware.deadair.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.playout.PlayoutState
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.nowplaying.AirModeRow
import com.maroonedsoftware.deadair.ui.nowplaying.HoldLine
import com.maroonedsoftware.deadair.ui.nowplaying.Lamp
import com.maroonedsoftware.deadair.ui.nowplaying.SilencePanel
import com.maroonedsoftware.deadair.ui.nowplaying.TransportHandlers
import com.maroonedsoftware.deadair.ui.nowplaying.TransportPair
import com.maroonedsoftware.deadair.ui.nowplaying.TransportUiState
import com.maroonedsoftware.deadair.ui.nowplaying.readSilence
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The desk: everything that can take the station off air, and why it is or is not on.
 *
 * A pushed page rather than a fifth tab, reached from Up next's overflow beside the other operator
 * verbs: it is a thing you go and do. Now playing keeps Skip, which ends one record and is a
 * listener-scale decision; Take off air, the hold, the air mode and the diagnosis live only here,
 * so the two Stops are on different screens and neither can be mistaken for the other.
 *
 * Top to bottom: the verdict, the pair, the record they act on, the hold, the air mode, and the
 * panel that says why — open on its own the moment there is a fault.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeskScreen(
    playout: PlayoutState,
    /** This phone's format, for the listeners line. */
    format: StreamFormat,
    artUrlFor: (String?) -> String?,
    /** An action is in flight, so every control waits for it. */
    busy: Boolean,
    handlers: TransportHandlers,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onSignIn: () -> Unit,
    snackbarHost: SnackbarHostState,
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHost) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.desk)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when (playout) {
                PlayoutState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.desk), onSignIn)
                PlayoutState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                PlayoutState.Unreachable -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
                is PlayoutState.Loaded -> {
                    val transport = TransportUiState(status = playout.status, air = playout.air, busy = busy)
                    Desk(
                        ui = DeskUiState(transport, readSilence(playout.status.silence)),
                        listeners = Message.Listeners(playout.status.listeners, format),
                        stale = playout.stale,
                        lastGoodAtMs = playout.lastGoodAtMs,
                        artUrlFor = artUrlFor,
                        handlers = handlers,
                    )
                }
            }
        }
    }
}

@Composable
private fun Desk(
    ui: DeskUiState,
    listeners: Message,
    stale: Boolean,
    lastGoodAtMs: Long?,
    artUrlFor: (String?) -> String?,
    handlers: TransportHandlers,
) {
    val transport = ui.transport
    Box(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
        Column(modifier = Modifier.widthIn(max = FormMaxWidth).fillMaxWidth().padding(horizontal = Gutter).padding(bottom = 24.dp)) {
            if (stale) StaleBanner(lastGoodAtMs, modifier = Modifier.padding(bottom = 12.dp))

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Lamp(ui.silence.tone, size = 12.dp)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(ui.heading.resolve(), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
                    Text(ui.line.resolve(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            TransportPair(transport, handlers, modifier = Modifier.padding(top = 20.dp))

            ui.record?.let { record -> Record(record, artUrlFor(record.artworkUrl), listeners) }

            transport.hold?.let { hold ->
                Label(R.string.hold_heading, modifier = Modifier.padding(top = 22.dp))
                HoldLine(hold, busy = transport.busy, onHold = handlers.onHold, onRelease = handlers.onRelease, centred = false)
            }

            transport.airMode?.let { mode ->
                Spacer(Modifier.height(14.dp))
                AirModeRow(mode, busy = transport.busy, onAirMode = handlers.onAirMode)
            }

            SilencePanel(ui.silence, modifier = Modifier.padding(top = 20.dp))
        }
    }
}

@Composable
private fun Record(record: DeskRecord, artworkUrl: String?, listeners: Message) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            modifier = Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (artworkUrl == null) {
                Icon(painterResource(R.drawable.ic_radio), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                AsyncImage(model = artworkUrl, contentDescription = null, modifier = Modifier.fillMaxSize())
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(record.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                record.line.resolve(),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            listeners.resolve(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            modifier = Modifier.widthIn(max = 96.dp),
        )
    }
}

@Composable
private fun Label(text: Int, modifier: Modifier = Modifier) {
    Text(stringResource(text), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
}
