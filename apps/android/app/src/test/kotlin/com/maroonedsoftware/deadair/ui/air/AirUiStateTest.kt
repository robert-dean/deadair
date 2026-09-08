package com.maroonedsoftware.deadair.ui.air

import com.maroonedsoftware.deadair.sdk.models.CatalogPlaylist
import com.maroonedsoftware.deadair.sdk.models.CatalogPlaylistPage
import com.maroonedsoftware.deadair.sdk.models.CatalogSourceError
import com.maroonedsoftware.deadair.sdk.models.CatalogTrack
import com.maroonedsoftware.deadair.sdk.models.PlayoutChartInputChartOrder
import com.maroonedsoftware.deadair.sdk.models.StationChart
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AirUiStateTest {
    private fun playlist(plugin: String, name: String) = CatalogPlaylist(pluginId = plugin, pluginName = plugin.replaceFirstChar { it.uppercase() }, id = "$plugin/$name", name = name)

    @Test
    fun `groups playlists by plugin, both sorted by name`() {
        val page =
            CatalogPlaylistPage(
                playlists = listOf(playlist("spotify", "Zed"), playlist("navidrome", "Beta"), playlist("spotify", "alpha")),
                errors = emptyList(),
            )
        val groups = AirUiState(page, emptyList()).groups

        assertEquals(listOf("Navidrome", "Spotify"), groups.map { it.pluginName })
        assertEquals(listOf("alpha", "Zed"), groups[1].playlists.map { it.name })
    }

    @Test
    fun `a plugin that could not be asked is reported beside the ones that answered`() {
        val page = CatalogPlaylistPage(playlists = listOf(playlist("navidrome", "Beta")), errors = listOf(CatalogSourceError("spotify", "Spotify", "token expired")))
        val ui = AirUiState(page, emptyList())

        assertEquals(1, ui.groups.size)
        assertEquals("token expired", ui.sourceErrors.single().message)
        assertFalse(ui.isEmpty)
    }

    @Test
    fun `is empty only with no playlists and no charts, and the playlists having failed outright counts as none`() {
        assertTrue(AirUiState(null, emptyList()).isEmpty)
        assertFalse(AirUiState(null, listOf(StationChart(id = "c", pluginId = "p", name = "Top 40"))).isEmpty)
    }

    @Test
    fun `a playlist with nothing in it cannot be aired`() {
        assertFalse(canAir(emptyList()))
        assertTrue(canAir(listOf(CatalogTrack(id = "t", title = "x", artists = emptyList()))))
    }

    @Test
    fun `countdown leads the chart orders`() {
        assertEquals(PlayoutChartInputChartOrder.COUNTDOWN, CHART_ORDERS.first())
        assertEquals(3, CHART_ORDERS.size)
    }

    @Test
    fun `a chart's qualifiers are where it is from and what it counts`() {
        assertEquals(listOf("GB", "rock"), chartQualifiers(StationChart(id = "c", pluginId = "p", name = "n", country = "GB", genre = "rock")))
        assertEquals(emptyList<String>(), chartQualifiers(StationChart(id = "c", pluginId = "p", name = "n", country = " ")))
    }
}
