import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRouter, RouterProvider } from '@tanstack/react-router';

// Self-hosted rather than fetched: the console is expected to run on a LAN beside the station,
// where a request to a font CDN is a request that may simply not complete.
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';

import '@mantine/core/styles.css';
// After Mantine's stylesheet: the theme's variable resolver points at `--da-*`, which this
// defines.
import './tokens.css';

import { createQueryClient } from './api/query.client';
import { routeTree } from './routeTree.gen';
import { cssVariablesResolver, theme } from './theme';

const queryClient = createQueryClient();

// The router's gates fetch through the same cache the components read from, so a loader and the
// hook rendering its data are one request, not two.
const router = createRouter({ routeTree, context: { queryClient } });

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Missing #root element in index.html');
}

createRoot(rootElement).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="dark">
                <RouterProvider router={router} />
            </MantineProvider>
            {/* Compiles to a stub component unless NODE_ENV is "development", so it needs no guard. */}
            <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-left" />
        </QueryClientProvider>
    </StrictMode>,
);
