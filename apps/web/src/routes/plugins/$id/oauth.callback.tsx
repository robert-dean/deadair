import { Card, Group, Loader, Stack, Text } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { PluginOAuthCallbackQuery } from '@deadair/sdk';

import { completePluginOAuth } from '../../../api/plugins.queries';
import { PluginOAuthCallbackPage } from '../../../components/plugins/plugin.oauth.callback.page';
import { SectionHeading } from '../../../components/shared/section.heading';

/** Only the three parameters the API's callback accepts survive; anything else the provider adds is dropped. */
function validateSearch(search: Record<string, unknown>): PluginOAuthCallbackQuery {
    const take = (key: 'code' | 'state' | 'error'): string | undefined => (typeof search[key] === 'string' ? search[key] : undefined);
    return { code: take('code'), state: take('state'), error: take('error') };
}

export const Route = createFileRoute('/plugins/$id/oauth/callback')({
    component: PluginOAuthCallbackRoute,
    pendingComponent: PluginOAuthCallbackPending,
    validateSearch,
    loaderDeps: ({ search }) => search,
    // The exchange runs here rather than in an effect: the `state` is single use, and a loader runs
    // once per navigation instead of twice per mount.
    loader: ({ context, params, deps }) => completePluginOAuth(context.queryClient, params.id, deps),
});

function PluginOAuthCallbackRoute() {
    const { id } = Route.useParams();
    const outcome = Route.useLoaderData();
    return <PluginOAuthCallbackPage id={id} outcome={outcome} />;
}

function PluginOAuthCallbackPending() {
    const { t } = useTranslation('routes');
    return (
        <Card withBorder padding="xl" radius="sm" maw={560}>
            <Stack gap="md">
                <SectionHeading title={t('pluginOAuth.title')} />
                <Group gap="sm">
                    <Loader size="sm" />
                    <Text c="dimmed">{t('pluginOAuth.completing')}</Text>
                </Group>
            </Stack>
        </Card>
    );
}
