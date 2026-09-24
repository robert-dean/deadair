import { Anchor, Badge, Button, Card, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { pluginDetailOptions, useSetPluginEnabled, useTestPlugin } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PluginConfigForm } from './plugin.config.form';
import { PluginLogsCard } from './plugin.logs.card';
import { PluginOAuthCard } from './plugin.oauth.card';
import { PLUGINS_PAGE_DEFAULTS } from './plugin.page.params';
import { PluginPermissionsCard } from './plugin.permissions.card';
import { PluginRemoveCard } from './plugin.remove.card';
import { PluginStanding } from './plugin.standing';
import { feedsTrackFetcher, hasConfigForm, hasOAuth, PluginOriginBadge, PluginStatusLamp, statusOf } from './plugin.status';
import { StreamAuthorizationCard } from './stream.authorization.card';

export interface PluginDetailPageProps {
    id: string;
}

/** One plugin: what it is doing, why it is not doing it, and everything an operator can change. */
export function PluginDetailPage({ id }: PluginDetailPageProps) {
    const { t } = useTranslation('plugins');
    const plugin = useQuery(pluginDetailOptions(id));
    const setEnabled = useSetPluginEnabled();
    const test = useTestPlugin(id);

    if (plugin.isPending) {
        return (
            <Stack gap="lg">
                <PageSkeleton variant="card" />
            </Stack>
        );
    }

    if (plugin.error || !plugin.data) {
        return (
            <Stack gap="md" align="flex-start">
                <ErrorAlert title={t('detail.unavailableTitle')} error={plugin.error} fallback={t('detail.unavailableFallback', { id })} />
                <Anchor renderRoot={(props: object) => <Link to="/plugins" search={PLUGINS_PAGE_DEFAULTS} {...props} />} size="sm">
                    {t('detail.backToPlugins')}
                </Anchor>
            </Stack>
        );
    }

    const detail = plugin.data;
    const status = statusOf(detail.status);

    return (
        <Stack gap="lg">
            {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                router's own types, and with them the check that this route still exists. */}
            <Anchor renderRoot={(props: object) => <Link to="/plugins" search={PLUGINS_PAGE_DEFAULTS} {...props} />} size="sm">
                <Group gap="xxs" wrap="nowrap">
                    <IconArrowLeft size={14} stroke={1.8} />
                    {t('detail.breadcrumb')}
                </Group>
            </Anchor>

            <Stack gap="xs">
                <PageHeader
                    title={detail.name}
                    description={
                        <Text size="sm" c="dimmed" ff="monospace">
                            {detail.id} · {detail.version}
                        </Text>
                    }
                    actions={
                        <Switch
                            checked={detail.enabled}
                            disabled={setEnabled.isPending}
                            label={detail.enabled ? t('enable.enabled') : t('enable.disabled')}
                            aria-label={t('enable.ariaLabel', { name: detail.name })}
                            onChange={event => {
                                setEnabled.mutate({ id: detail.id, enabled: event.currentTarget.checked });
                            }}
                        />
                    }
                >
                    {detail.description ? <Text c="dimmed">{detail.description}</Text> : undefined}

                    <Group gap="sm" mt="xs">
                        <PluginStatusLamp status={detail.status} size="md" />
                        <Text size="sm" c="dimmed">
                            {status.description}
                        </Text>
                        <PluginOriginBadge plugin={detail} />
                    </Group>

                    {detail.capabilities.length > 0 ? (
                        <Group gap="xxs">
                            {detail.capabilities.map(capability => (
                                <Badge key={capability} size="sm" variant="light" color="gray" tt="none">
                                    {capability}
                                </Badge>
                            ))}
                        </Group>
                    ) : undefined}

                    {/* Where this plugin stands for each contested job, linking to the page that
                        decides. Most load-bearing on this page rather than the card: disabling a
                        plugin the station was told to use happens here. */}
                    <PluginStanding pluginId={detail.id} />
                </PageHeader>

                {setEnabled.error ? (
                    <ErrorAlert title={t('detail.enableFailedTitle')} error={setEnabled.error} fallback={t('detail.enableFailedFallback')} />
                ) : undefined}

                {detail.lastError ? (
                    <ErrorAlert title={t('detail.lastError')}>
                        <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                            {detail.lastError}
                        </Text>
                        {/* A plugin that never loaded is usually a directory problem: an unbuilt
                            install, a missing entry, a copy in the wrong place. Where the station
                            looked is the first thing needed to fix any of them. */}
                        {detail.status === 'failed' ? (
                            <Text size="xs" c="dimmed" ff="monospace" mt="xs" style={{ overflowWrap: 'anywhere' }}>
                                {t('detail.loadedFrom', { dir: detail.dir })}
                            </Text>
                        ) : undefined}
                    </ErrorAlert>
                ) : undefined}
            </Stack>

            <Card padding="lg">
                <Stack gap="md">
                    <Group justify="space-between" align="center">
                        <Stack gap="xxxs">
                            <Title order={3} size="h5">
                                {t('detail.test.title')}
                            </Title>
                            <Text size="sm" c="dimmed">
                                {t('detail.test.description')}
                            </Text>
                        </Stack>
                        <Button
                            variant="default"
                            size="compact-sm"
                            loading={test.isPending}
                            onClick={() => {
                                test.mutate();
                            }}
                        >
                            {t('detail.test.button')}
                        </Button>
                    </Group>

                    {/* `ok: false` is the answer to the question, not a failed request, so it is
                        reported in the same place a success would be. */}
                    {test.data ? (
                        <Text size="sm" c={test.data.ok ? 'teal' : 'red'}>
                            {test.data.ok ? (test.data.message ?? t('detail.test.connected')) : (test.data.message ?? t('detail.test.notConnected'))}
                        </Text>
                    ) : undefined}
                    {test.error ? (
                        <Text size="sm" c="red">
                            {apiErrorMessage(test.error, t('detail.test.failed'))}
                        </Text>
                    ) : undefined}
                </Stack>
            </Card>

            {/* Before the settings form: a refused capability makes a plugin behave as though it
                were misconfigured, so the unanswered question should be met before an operator
                starts rewriting settings that were never wrong. */}
            <PluginPermissionsCard plugin={detail} />

            <Card padding="lg">
                <Stack gap="md">
                    <Stack gap="xxs">
                        <Title order={3} size="h5">
                            {t('detail.settings.title')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {t('detail.settings.description')}
                        </Text>
                    </Stack>
                    <Divider />
                    {hasConfigForm(detail) ? (
                        <PluginConfigForm plugin={detail} />
                    ) : (
                        <Text size="sm" c="dimmed">
                            {t('detail.settings.none')}
                        </Text>
                    )}
                </Stack>
            </Card>

            {hasOAuth(detail) ? <PluginOAuthCard plugin={detail} /> : undefined}

            {/* Below the connection card deliberately: these are two credentials in a sequence, and
                this is the second one. */}
            {feedsTrackFetcher(detail) ? <StreamAuthorizationCard plugin={detail} /> : undefined}

            <PluginLogsCard plugin={detail} />

            {detail.origin === 'installed' ? <PluginRemoveCard plugin={detail} /> : undefined}
        </Stack>
    );
}
