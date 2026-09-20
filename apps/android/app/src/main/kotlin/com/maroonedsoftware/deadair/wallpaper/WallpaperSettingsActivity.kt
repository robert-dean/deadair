package com.maroonedsoftware.deadair.wallpaper

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.settings.WallpaperSection
import com.maroonedsoftware.deadair.ui.theme.DeadairTheme
import com.maroonedsoftware.deadair.ui.theme.FormMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter
import kotlinx.coroutines.launch

/**
 * The wallpaper's own settings, as the system's picker offers them.
 *
 * The picker draws a Settings button for a live wallpaper that names one, and somebody who set the
 * wallpaper from there has no reason to know the app has the same two choices in it. The same
 * section either way, so the two cannot drift apart. It writes to the same store the app does, and
 * the running wallpaper is watching that store, so a change here reaches the screen behind it at
 * once.
 */
class WallpaperSettingsActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val store = (application as DeadairApp).graph.settings
        setContent {
            val settings by store.settings.collectAsStateWithLifecycle(initialValue = ListenerSettings())
            DeadairTheme(dynamicColor = settings.dynamicColor) {
                Scaffold(
                    topBar = {
                        TopAppBar(
                            title = { Text(stringResource(R.string.wallpaper_label)) },
                            navigationIcon = {
                                IconButton(onClick = { finish() }) {
                                    Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                                }
                            },
                        )
                    },
                ) { padding ->
                    Box(
                        modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
                        contentAlignment = Alignment.TopCenter,
                    ) {
                        WallpaperSection(
                            follows = settings.wallpaperFollows,
                            idle = settings.wallpaperIdle,
                            onFollows = { follows -> lifecycleScope.launch { store.setWallpaperFollows(follows) } },
                            onIdle = { idle -> lifecycleScope.launch { store.setWallpaperIdle(idle) } },
                            placement = settings.wallpaperPlacement,
                            onPlacement = { placement -> lifecycleScope.launch { store.setWallpaperPlacement(placement) } },
                            colors = settings.wallpaperColorSource,
                            color = settings.wallpaperColor,
                            onColors = { colors -> lifecycleScope.launch { store.setColorSource(colors) } },
                            onColor = { color -> lifecycleScope.launch { store.setWallpaperColor(color) } },
                            // The picker is where this was opened from; offering to open it again is a loop.
                            showsSetButton = false,
                            modifier = Modifier.widthIn(max = FormMaxWidth).padding(horizontal = Gutter),
                        )
                    }
                }
            }
        }
    }
}
