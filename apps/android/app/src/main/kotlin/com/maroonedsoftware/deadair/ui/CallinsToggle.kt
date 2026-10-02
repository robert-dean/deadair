package com.maroonedsoftware.deadair.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R

/**
 * Whether somebody phones in during the broadcast this screen puts on air.
 *
 * Off unless ticked, and the programme's answer alone: the station has no setting behind it, so an
 * unticked row, which sends nothing, is no calls.
 */
@Composable
fun CallinsToggle(checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    CheckRow(R.string.plan_callins, R.string.plan_callins_desc, checked, enabled, onChange, modifier)
}

/**
 * Whether records that sound like the playlist's own are mixed in among them, one every few.
 *
 * Unticked sends NOTHING rather than `false`, which leaves the station's `rotation.mixInSimilar`
 * standing: a station with it on mixes into every playlist without anybody ticking this, exactly as
 * the console's plain Air press does. Ticked is the console's "Air with similar records mixed in".
 */
@Composable
fun MixInSimilarToggle(checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    CheckRow(R.string.air_mix_in_similar, R.string.air_mix_in_similar_desc, checked, enabled, onChange, modifier)
}

@Composable
private fun CheckRow(title: Int, description: Int, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onChange).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
        Column(modifier = Modifier.padding(start = 12.dp)) {
            Text(stringResource(title), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(description), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
