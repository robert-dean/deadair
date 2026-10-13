import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

// Only the faces the two consoles this page can get are set in: carbon's and paper's. See `main.tsx`
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
import { InviteApp } from './invite.app';

/**
 * The invite page's entry: a third page beside the console and the party page, sharing their theme,
 * words and SDK and nothing of the console's router or sign-in.
 *
 * The device chooses the console it gets, carbon when it is set to dark and paper when it is set to
 * light, since somebody with no account yet has no Appearance settings to choose one in.
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
                <InviteApp />
            </MantineProvider>
        </QueryClientProvider>
    </StrictMode>,
);
