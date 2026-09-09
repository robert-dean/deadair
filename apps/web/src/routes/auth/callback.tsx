import { Card, Center, Group, Image, Loader, Stack, Text, Title } from '@mantine/core';
import { createFileRoute, Navigate } from '@tanstack/react-router';

import { completeAuthCallback, type AuthCallbackOutcome, type AuthCallbackQuery } from '../../api/auth.callback.queries';
import { AuthCallbackPanel } from '../../components/auth/auth.callback.panel';

/** Only what the API sends back survives; anything else appended to the link is dropped. */
function validateSearch(search: Record<string, unknown>): AuthCallbackQuery {
    const take = (key: keyof AuthCallbackQuery): string | undefined => (typeof search[key] === 'string' ? search[key] : undefined);
    return { token: take('token'), challenge_id: take('challenge_id'), error: take('error'), error_description: take('error_description') };
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

    // Nothing to draw: the session is stored and the shell is what they came for.
    if (outcome.kind === 'signed-in') return <Navigate to="/" replace />;

    return <AuthCallbackPanel outcome={outcome} />;
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
