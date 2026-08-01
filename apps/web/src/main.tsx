import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { createRouter, RouterProvider } from '@tanstack/react-router';

import '@mantine/core/styles.css';

import { routeTree } from './routeTree.gen';
import { theme } from './theme';

const router = createRouter({ routeTree });

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
        <MantineProvider theme={theme} forceColorScheme="dark">
            <RouterProvider router={router} />
        </MantineProvider>
    </StrictMode>,
);
