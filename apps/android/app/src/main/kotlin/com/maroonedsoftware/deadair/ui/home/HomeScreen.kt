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
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import com.maroonedsoftware.deadair.R

/**
 * Which of the station's faces is showing.
 *
 * The tabs are an enum and a `when`, and they are deliberately not entries on the back stack:
 * switching between them is not leaving the screen, and back from any of them returns to the first
 * rather than unwinding a history of taps. The stack proper — a record page, an album behind it,
 * settings over the top — is `ui/nav/Destination.kt`'s, and `Home` is one entry on it however many
 * tabs it holds. Settings is reached from the bar above rather than the one below, because it is a
 * thing you go and do rather than a thing you look at.
 */
enum class Tab(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    NOW_PLAYING(R.string.tab_now_playing, R.drawable.ic_radio),
    HISTORY(R.string.tab_history, R.drawable.ic_history),
    WHATS_ON(R.string.tab_whats_on, R.drawable.ic_schedule),
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
    // The bar gives way to a list that scrolls under it and comes back on the first pull down,
    // which is what Material expects of an app bar above a list and what a flat bar over sliding
    // content fails to do.
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = { Text(station, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                scrollBehavior = scrollBehavior,
                actions = {
                    IconButton(onClick = onSettings) {
                        Icon(painterResource(R.drawable.ic_settings), contentDescription = stringResource(R.string.settings))
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
                        icon = { Icon(painterResource(entry.icon), contentDescription = stringResource(entry.label)) },
                        label = { Text(stringResource(entry.label)) },
                    )
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) { content() }
    }
}
