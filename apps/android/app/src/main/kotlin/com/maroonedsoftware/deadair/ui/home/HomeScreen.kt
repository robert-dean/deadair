package com.maroonedsoftware.deadair.ui.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import com.maroonedsoftware.deadair.R

/**
 * Which of the station's faces is showing.
 *
 * An enum and a `when`, with no navigation library behind it. A handful of destinations, no back
 * stack worth the name, no deep links and no route strings: what a library would add here is a dependency
 * and a second place for the answer to live. Settings is still not one of these — it is a screen
 * over the top of whichever tab is showing, reached from the bar above rather than the one below,
 * because it is a thing you go and do rather than a thing you look at.
 */
enum class Tab(val label: String, val icon: Int) {
    NOW_PLAYING("Now playing", R.drawable.ic_radio),
    HISTORY("Played", R.drawable.ic_history),
    WHATS_ON("What's on", R.drawable.ic_schedule),
}

/**
 * The frame the tabs live in: one app bar, one bottom bar, and whichever tab is showing between them.
 *
 * The bar and the title belong here rather than to any tab, which is why `NowPlayingScreen` gave up
 * its own `Scaffold` to get here. Three screens each carrying their own would be three chances for
 * the station's name to sit a few pixels differently, and switching tabs would redraw the bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    station: String,
    tab: Tab,
    onTab: (Tab) -> Unit,
    onSettings: () -> Unit,
    content: @Composable () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(station, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    IconButton(onClick = onSettings) {
                        Icon(painterResource(R.drawable.ic_settings), contentDescription = "Settings")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { entry ->
                    NavigationBarItem(
                        selected = entry == tab,
                        onClick = { onTab(entry) },
                        // The label is the description as well: it says the same thing, and a
                        // screen reader announcing something different from what is written under
                        // the icon is worse than one repeating it.
                        icon = { Icon(painterResource(entry.icon), contentDescription = entry.label) },
                        label = { Text(entry.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) { content() }
    }
}
