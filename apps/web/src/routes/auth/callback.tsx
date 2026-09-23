import { Card, Center, Group, Image, Loader, Stack, Text, Title } from '@mantine/core';
import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { completeAuthCallback, type AuthCallbackOutcome, type AuthCallbackQuery } from '../../api/auth.callback.queries';
import { AuthCallbackPanel } from '../../components/auth/auth.callback.panel';
import { safeRedirectTarget } from '../../auth/redirect.target';

/** Only what the API sends back survives; anything else appended to the link is dropped. */
function validateSearch(search: Record<string, unknown>): AuthCallbackQuery {
    const take = (key: keyof AuthCallbackQuery): string | undefined => (typeof search[key] === 'string' ? search[key] : undefined);
    return {
        token: take('token'),
        challenge_id: take('challenge_id'),
        error: take('error'),
        error_description: take('error_description'),
        redirect: take('redirect'),
    };
}

export const Route = createFileRoute('/auth/callback')({
    component: AuthCallbackRoute,
    pendingComponent: AuthCallbackPending,
    validateSearch,
    loaderDeps: ({ search }) => search,
    // In the loader rather than an effect, for the reason the plugin OAuth callback gives: the
    // token is single use and a loader runs once per navigation, where an effect runs twice per
    // mount under StrictMode — and the second run would redeem a token the first had spent.
    loader: ({ deps }) => completeAuthCallback(deps),
});

function AuthCallbackRoute() {
    const outcome: AuthCallbackOutcome = Route.useLoaderData();
    // Sanitised again here, although the API already did: this is a URL anybody can type.
    const target = safeRedirectTarget(Route.useSearch().redirect);

    // Nothing to draw: the session is stored and the shell is what they came for.
    if (outcome.kind === 'signed-in') return <GoTo href={target} />;

    return <AuthCallbackPanel outcome={outcome} redirect={target} />;
}

function AuthCallbackPending() {
    return (
        <Center mih="70vh">
            <Card padding="xl" w="100%" maw={400}>
                <Stack gap="md" align="center">
                    <Image src="/logo-mark.png" alt="" aria-hidden w={64} h={64} />
                    <Title order={2}>Signing you in</Title>
                    <Group gap="sm">
                        <Loader size="sm" />
                        <Text c="dimmed" size="sm">
                            One moment.
                        </Text>
                    </Group>
                </Stack>
            </Card>
        </Center>
    );
}

/**
 * Replaces this page with a path that may carry a query. `<Navigate>` takes only `to`, which would read
 * `/oauth/authorize?client_id=...` as one long path; `href` is parsed into a path and a search.
 */
function GoTo({ href }: { href: string }) {
    const navigate = useNavigate();
    useEffect(() => {
        void navigate({ href, replace: true });
    }, [href, navigate]);
    return null;
}
