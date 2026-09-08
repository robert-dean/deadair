package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.FactClaim
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve

/**
 * What the enrichment providers said, on a phone.
 *
 * The console's panel with the same order and the same omissions: tags, the scalars that resolved,
 * the station's own claims with their quotes one tap away, the providers' facts, the biography
 * folded, the links, and who said all of it and when. The raw unmapped fields are left off: they are
 * a debugging affordance for a laptop.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EnrichmentPanel(state: LoadState<EnrichmentUiState>, emptyMessage: String, modifier: Modifier = Modifier) {
    OutlinedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.enrichment_heading), style = MaterialTheme.typography.titleSmall)
            when (state) {
                LoadState.Loading -> Text(stringResource(R.string.loading), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                is LoadState.Failed -> Text(stringResource(R.string.enrichment_failed), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                is LoadState.Loaded -> {
                    val ui = state.value
                    if (ui.isEmpty) {
                        Text(emptyMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Facts(ui)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Facts(ui: EnrichmentUiState) {
    if (ui.tags.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ui.tags.forEach { tag ->
                Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.small) {
                    Text(tag, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }
        }
    }

    if (ui.scalars.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ui.scalars.forEach { (field, value) ->
                Column(modifier = Modifier.widthIn(min = 96.dp)) {
                    Text(Message.Field(field).resolve(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(value, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }

    // Above the providers' own facts, because these are the ones with a source behind them and the
    // ones the presenter reaches for first.
    ui.claims.forEach { Claim(it) }

    if (ui.facts.facts.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ui.facts.facts.forEach { fact ->
                Row {
                    Text("•", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 8.dp))
                    Text(fact, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }

    ui.facts.biography?.takeIf { it.isNotBlank() }?.let { Biography(it) }

    if (ui.facts.links.isNotEmpty()) {
        val uris = LocalUriHandler.current
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            ui.facts.links.forEach { link -> TextButton(onClick = { uris.openUri(link.url) }) { Text(link.label) } }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        ui.sources.forEach { source ->
            Text(
                Message.Provenance(source).resolve(),
                style = MaterialTheme.typography.labelSmall,
                color = if (source.failed) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * One thing the station believes, and the words it read that say so. The quote is the reason this
 * exists: a claim is a sentence the presenter will say out loud, and the only way to know whether
 * it is true is to read where it came from.
 */
@Composable
private fun Claim(claim: FactClaim) {
    var open by rememberSaveable(claim.id.toString()) { mutableStateOf(false) }
    val uris = LocalUriHandler.current
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(claim.category.replace('_', ' '), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary)
        Text(claim.claim, style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { open = !open }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
            Text(stringResource(if (open) R.string.hide_source else R.string.show_source), style = MaterialTheme.typography.labelMedium)
        }
        if (open) {
            Text("“${claim.sourceQuote}”", style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { uris.openUri(claim.sourceUrl) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Text(claim.sourceUrl, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun Biography(text: String) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column {
        Text(text, style = MaterialTheme.typography.bodyMedium, maxLines = if (open) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis)
        TextButton(onClick = { open = !open }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
            Text(stringResource(if (open) R.string.show_less else R.string.read_more), style = MaterialTheme.typography.labelMedium)
        }
    }
}
