import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRouter, RouterProvider } from '@tanstack/react-router';

// Self-hosted rather than fetched: the console is expected to run on a LAN beside the station,
// where a request to a font CDN is a request that may simply not complete.
//
// All three themes' faces are imported here, eagerly, and that costs almost nothing: an import
// brings in `@font-face` DECLARATIONS, and a browser fetches a woff2 only when rendered text
// actually matches one. An operator on carbon never downloads Archivo. Lazily importing per theme
// would buy a few KB of CSS and pay for it in a frame of fallback type on every theme switch.
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
// Studio White: a serif masthead over a grotesque, which is what a paper console reads as.
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/public-sans/700.css';
// Neon Transmitter: a grotesque under the same angular display face carbon uses, which is the pair
// a heads-up display is set in. Space Mono ships 400 and 700 and nothing between, so the `fw={600}`
// every `Eyebrow` asks for in the mono face resolves to 700 here. That is the right answer for a
// silkscreened legend and the wrong kind of surprise to leave undocumented.
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';

// This order is required rather than conventional: `@mantine/schedule` builds on `@mantine/dates`,
// which builds on core, and each expects the one below it to have been laid down first. Loaded out
// of order the timetable renders unstyled rather than merely differently.
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/schedule/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
// LAST, after every Mantine stylesheet: the theme's variable resolver points at `--da-*`, which this
// defines, and the console's own surfaces have to win over the packages'.
import './tokens.css';

import { createQueryClient } from './api/query.client';
import { PageSkeleton } from './components/shared/page.skeleton';
import { RouteError } from './components/shared/route.error';
import { routeTree } from './routeTree.gen';
import { useTheme } from './theme.store';

const queryClient = createQueryClient();

// The router's gates fetch through the same cache the components read from, so a loader and the
// hook rendering its data are one request, not two.
//
// The two defaults are the console's floor rather than its preference: a route that says nothing
// about failing or waiting gets these, and a page with a better answer of its own still overrides
// them. Before they existed a loader that threw drew an unstyled message with no way back, and a
// slow one drew nothing at all.
const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultErrorComponent: RouteError,
    // `rows` because that is what most of this console is, and the skeleton being the wrong SHAPE
    // is the flicker `page.skeleton.tsx` was written to stop.
    defaultPendingComponent: () => <PageSkeleton variant="rows" count={4} />,
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Missing #root element in index.html');
}

/**
 * The provider stack, in a component so the chosen theme can be read with a hook.
 *
 * `forceColorScheme` rather than Mantine's own scheme handling, still: the console does not offer a
 * light/dark toggle, it offers three consoles, and which half of Mantine's variables each one draws
 * from is a property of that theme rather than of the browser. `theme.store.ts` has already written
 * `data-da-theme` for the stylesheet by the time this renders.
 */
function Console() {
    const chosen = useTheme();

    return (
        <MantineProvider theme={chosen.mantine} cssVariablesResolver={chosen.resolver} forceColorScheme={chosen.scheme}>
            {/* Top right, and that is the one thing about this that is not a default. It used
                to be because the transport bar was fixed to the bottom edge; that bar is gone,
                and the reason survived it — the tally now sits in the header at top LEFT, so
                this corner is still the one where a stack of toasts cannot cover the state of
                the station to tell you a setting saved. */}
            <Notifications position="top-right" limit={3} />
            <RouterProvider router={router} />
        </MantineProvider>
    );
}

createRoot(rootElement).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <Console />
            {/* Compiles to a stub component unless NODE_ENV is "development", so it needs no guard. */}
            <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        </QueryClientProvider>
    </StrictMode>,
);
