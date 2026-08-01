import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { render as testingLibraryRender, type RenderResult } from '@testing-library/react';

import { theme } from '../../src/theme';

/** Renders under the app's provider stack. `env="test"` disables transitions and portals. */
export function render(ui: ReactNode): RenderResult {
    return testingLibraryRender(ui, {
        wrapper: ({ children }) => (
            <MantineProvider theme={theme} env="test" forceColorScheme="dark">
                {children}
            </MantineProvider>
        ),
    });
}

export { screen, waitFor, within } from '@testing-library/react';
