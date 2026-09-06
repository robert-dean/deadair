package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The frame every detail page shares: a bar with a back arrow, and the loaded thing in a scrolling
 * column, or the one placeholder for it not having loaded.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> DetailScaffold(
    title: String,
    state: LoadState<T>,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    /** What a status means here, for the placeholder: a 404 on a record page is "not in the catalog". */
    failureText: @Composable (Int?) -> String,
    content: @Composable (T) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        when (state) {
            LoadState.Loading ->
                Box(modifier = Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            is LoadState.Failed -> Box(modifier = Modifier.fillMaxSize().padding(padding)) { ErrorPlaceholder(failureText(state.status), onRetry) }
            is LoadState.Loaded ->
                Column(
                    modifier =
                        Modifier.fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(padding)
                            .consumeWindowInsets(padding)
                            .padding(PaddingValues(horizontal = Gutter, vertical = 16.dp)),
                ) {
                    content(state.value)
                }
        }
    }
}

/** A section heading inside a detail page. */
@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(text, style = androidx.compose.material3.MaterialTheme.typography.titleMedium, modifier = modifier.fillMaxWidth().padding(top = 24.dp, bottom = 8.dp))
}
