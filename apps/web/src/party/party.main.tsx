import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

// Only the faces the two consoles a guest can get are set in: carbon's and paper's. See `main.tsx`
// on why importing a face costs a declaration and not a download.
import '@fontsource/chakra-petch/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '../tokens.css';

import '../i18n/i18n.setup';
import { THEMES } from '../themes';
import { PartyApp } from './party.app';

/**
 * The guest request page's entry: a second page beside the console, sharing its theme, words and SDK
 * and nothing of its router or sign-in.
 *
 * A guest's phone chooses the console it gets, carbon when it is set to dark and paper when it is set
 * to light, since a guest has no Appearance settings to choose one in and a white page in a dark room
 * is the wrong first thing to show somebody at a party.
 */
const chosen = THEMES[window.matchMedia('(prefers-color-scheme: light)').matches ? 'white' : 'carbon'];
document.documentElement.setAttribute('data-da-theme', chosen.id);
document.documentElement.setAttribute('data-mantine-color-scheme', chosen.scheme);

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 5_000 } } });

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <MantineProvider theme={chosen.mantine} cssVariablesResolver={chosen.resolver} forceColorScheme={chosen.scheme}>
                <Notifications position="top-center" limit={2} />
                <PartyApp />
            </MantineProvider>
        </QueryClientProvider>
    </StrictMode>,
);
