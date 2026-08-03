import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PluginOAuthCallbackPage } from '../../../src/components/plugins/plugin.oauth.callback.page';
import { render, screen } from '../../utils/render';

vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
        <a href="#" className={className}>
            {children}
        </a>
    ),
}));

describe('PluginOAuthCallbackPage', () => {
    it('reports a completed authorization', () => {
        render(<PluginOAuthCallbackPage id="deadair.spotify" outcome={{ result: { pluginId: 'deadair.spotify', ok: true } }} />);

        expect(screen.getByText('Connected. The plugin has stored its tokens.')).toBeInTheDocument();
        expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
    });

    it('repeats the API sentence when the authorization did not complete', () => {
        const result = { pluginId: 'deadair.spotify', ok: false, message: 'the authorization could not be completed' };

        render(<PluginOAuthCallbackPage id="deadair.spotify" outcome={{ result }} />);

        expect(screen.getByText('Not connected')).toBeInTheDocument();
        expect(screen.getByText('the authorization could not be completed')).toBeInTheDocument();
    });

    it('reports a request that never got an answer', () => {
        render(<PluginOAuthCallbackPage id="deadair.spotify" outcome={{ failure: 'The API is unreachable.' }} />);

        expect(screen.getByText('The API is unreachable.')).toBeInTheDocument();
    });

    it('does not claim success for a verdict that arrived without a message', () => {
        render(<PluginOAuthCallbackPage id="deadair.spotify" outcome={{ result: { pluginId: 'deadair.spotify', ok: false } }} />);

        expect(screen.getByText('The authorization could not be completed.')).toBeInTheDocument();
    });
});
