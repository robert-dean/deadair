// Whether the identity providers just saved will work, said on the settings page. The properties that
// matter: a provider that did not answer says why; a row the station dropped is shown rather than
// silently missing; nothing is asked of a station with no providers; and somebody without the
// operator role sees nothing rather than an error.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { SigninCheckCard } from '../../../src/components/settings/signin.check.card';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const getSettings = vi.fn();
const checkSignInProviders = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        settings: {
            getSettings: (...args: unknown[]) => getSettings(...args),
            checkSignInProviders: (...args: unknown[]) => checkSignInProviders(...args),
        },
    },
}));

afterEach(() => {
    getSettings.mockReset();
    checkSignInProviders.mockReset();
});

const withProviders = (providers: string) => ({ descriptors: [], values: { 'signin.providers': providers }, configured: {}, derived: {} });
const ROWS = JSON.stringify([{ name: 'google' }, { name: 'keycloak' }]);

describe('SigninCheckCard', () => {
    it('says which providers answered and why the others did not', async () => {
        getSettings.mockResolvedValue(withProviders(ROWS));
        checkSignInProviders.mockResolvedValue({
            providers: [
                { name: 'google', label: 'Google', issuer: 'https://accounts.google.com/', ok: true },
                {
                    name: 'keycloak',
                    label: 'Keycloak',
                    issuer: 'https://auth.example.com/realms/your-realm',
                    ok: false,
                    problem: 'There is no server at auth.example.com.',
                },
            ],
            unusable: [],
        });

        render(<SigninCheckCard />);

        expect(await screen.findByText('There is no server at auth.example.com.')).toBeInTheDocument();
        expect(screen.getByText('Answers')).toBeInTheDocument();
        expect(screen.getByText('No answer')).toBeInTheDocument();
    });

    it('shows a row the station dropped, whose button would otherwise just never appear', async () => {
        getSettings.mockResolvedValue(withProviders(ROWS));
        const sentence = 'Provider "keycloak" is skipped because its button, issuer or client id is missing or not usable.';
        checkSignInProviders.mockResolvedValue({ providers: [], unusable: [sentence] });

        render(<SigninCheckCard />);

        expect(await screen.findByText(sentence)).toBeInTheDocument();
        expect(screen.getByText('Not offered')).toBeInTheDocument();
    });

    it('asks nothing of a station with no providers, since every ask reaches out to each issuer', async () => {
        getSettings.mockResolvedValue(withProviders('[]'));

        render(<SigninCheckCard />);

        await waitFor(() => expect(getSettings).toHaveBeenCalled());
        expect(checkSignInProviders).not.toHaveBeenCalled();
        expect(screen.queryByText('Do they answer?')).not.toBeInTheDocument();
    });

    it('asks again when told to', async () => {
        getSettings.mockResolvedValue(withProviders(ROWS));
        checkSignInProviders.mockResolvedValue({ providers: [], unusable: [] });
        const user = setupUser();

        render(<SigninCheckCard />);
        // Busy while the first ask is out, so wait for it to settle before pressing.
        await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Check again' }));

        await waitFor(() => expect(checkSignInProviders).toHaveBeenCalledTimes(2));
    });

    it('shows nothing to somebody without the operator role', async () => {
        getSettings.mockResolvedValue(withProviders(ROWS));
        checkSignInProviders.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));

        render(<SigninCheckCard />);

        await waitFor(() => expect(checkSignInProviders).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByText('Do they answer?')).not.toBeInTheDocument());
        expect(screen.queryByText('Not checked')).not.toBeInTheDocument();
    });
});
