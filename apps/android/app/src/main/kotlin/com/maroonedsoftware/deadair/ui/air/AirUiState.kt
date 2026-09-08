package com.maroonedsoftware.deadair.ui.air

import com.maroonedsoftware.deadair.sdk.models.CatalogPlaylist
import com.maroonedsoftware.deadair.sdk.models.CatalogPlaylistPage
import com.maroonedsoftware.deadair.sdk.models.CatalogSourceError
import com.maroonedsoftware.deadair.sdk.models.CatalogTrack
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInputChartOrder
import com.maroonedsoftware.deadair.sdk.models.StationChart

/** One plugin's playlists, under its name. */
data class PlaylistGroup(val pluginId: String, val pluginName: String, val playlists: List<CatalogPlaylist>)

/**
 * What can be put on air from the phone: every plugin's playlists, grouped by plugin, and the
 * charts anything offers.
 *
 * A plugin that could not be asked is reported beside the ones that answered rather than failing
 * the page: one provider being down is the ordinary state of a station with several, and the other
 * playlists are still worth airing.
 */
data class AirUiState(val playlists: CatalogPlaylistPage?, val charts: List<StationChart>) {
    val groups: List<PlaylistGroup>
        get() =
            playlists?.playlists.orEmpty()
                .groupBy { it.pluginId }
                .map { (pluginId, list) -> PlaylistGroup(pluginId, list.first().pluginName, list.sortedBy { it.name.lowercase() }) }
                .sortedBy { it.pluginName.lowercase() }

    val sourceErrors: List<CatalogSourceError> get() = playlists?.errors.orEmpty()

    val isEmpty: Boolean get() = groups.isEmpty() && charts.isEmpty()
}

/** The station refuses to air a playlist with nothing in it, so the button is not offered for one. */
fun canAir(tracks: List<CatalogTrack>): Boolean = tracks.isNotEmpty()

/**
 * Which way round a chart is played. A countdown is the shape a chart show has on the radio, so it
 * leads and is the default; the other two are here because neither is wrong.
 */
val CHART_ORDERS: List<PlayoutChartInputChartOrder> =
    listOf(PlayoutChartInputChartOrder.COUNTDOWN, PlayoutChartInputChartOrder.RANKED, PlayoutChartInputChartOrder.UNORDERED)

/** What distinguishes a chart from the others a plugin offers: where it is from and what it counts. */
fun chartQualifiers(chart: StationChart): List<String> = listOfNotNull(chart.country, chart.genre).filter { it.isNotBlank() }
