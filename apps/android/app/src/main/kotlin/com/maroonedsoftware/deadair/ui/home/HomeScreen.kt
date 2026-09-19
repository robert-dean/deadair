package com.maroonedsoftware.deadair.ui.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalLayoutDirection
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
 * History behind Up next — is `ui/nav/Destination.kt`'s, and `Home` is one entry on it however many
 * tabs it holds. Settings is the fourth tab rather than a gear in every app bar: a gear above a list
 * of records said nothing about the records.
 */
enum class Tab(@param:StringRes val label: Int, @param:DrawableRes val icon: Int) {
    NOW_PLAYING(R.string.tab_now_playing, R.drawable.ic_radio),
    UP_NEXT(R.string.tab_up_next, R.drawable.ic_queue),
    WHATS_ON(R.string.tab_whats_on, R.drawable.ic_schedule),
    SETTINGS(R.string.settings, R.drawable.ic_settings),
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
    /** What the bar says: the station's name, or the name of a tab that is not about the station. */
    title: String,
    tab: Tab,
    onTab: (Tab) -> Unit,
    /** Whether the tab has a bar over it. Without one the tab draws to the top of the screen and minds the status bar itself. */
    topBar: Boolean = true,
    /** Whether the tabs are showing. Now playing puts them away while it rests. */
    bottomBar: Boolean = true,
    snackbarHost: SnackbarHostState,
    /** The tab's own actions. Empty for a tab that has none. */
    actions: @Composable RowScope.() -> Unit = {},
    /** The player bar over the tabs, or `null` on a tab that has the station's button already. */
    miniPlayer: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    // The bar gives way to a list that scrolls under it and comes back on the first pull down,
    // which is what Material expects of an app bar above a list and what a flat bar over sliding
    // content fails to do.
    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        snackbarHost = { SnackbarHost(snackbarHost) },
        topBar = {
            if (topBar) {
                TopAppBar(
                    title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    scrollBehavior = scrollBehavior,
                    actions = actions,
                )
            }
        },
        bottomBar = {
            // The player bar sits on the tabs rather than inside a tab, so the Scaffold pads the
            // content by both and a list's last row is never under it; the snackbar lands above both.
            AnimatedVisibility(visible = bottomBar, enter = slideInVertically { it }, exit = slideOutVertically(tween(900)) { it }) {
                Column {
                    miniPlayer?.invoke()
                    NavigationBar {
                        Tab.entries.forEach { entry ->
                            NavigationBarItem(
                                selected = entry == tab,
                                onClick = { onTab(entry) },
                                // The item merges its icon and label into one node for a screen reader, so
                                // a description on the icon as well read every tab twice: "Played, Played".
                                icon = { Icon(painterResource(entry.icon), contentDescription = null) },
                                label = { Text(stringResource(entry.label)) },
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        // Consumed as well as applied, so a tab that pads itself by the keyboard (Settings) adds
        // only what the keyboard takes beyond the bars rather than both.
        // Without a bar, only the sides and the foot are padded: the top is the tab's, so a cover can
        // run under the status bar.
        val applied =
            if (topBar) {
                padding
            } else {
                val direction = LocalLayoutDirection.current
                PaddingValues(start = padding.calculateStartPadding(direction), end = padding.calculateEndPadding(direction), bottom = padding.calculateBottomPadding())
            }
        Box(modifier = Modifier.fillMaxSize().padding(applied).consumeWindowInsets(applied)) { content() }
    }
}
