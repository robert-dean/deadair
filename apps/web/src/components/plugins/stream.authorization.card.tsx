import { useState } from 'react';
import { Alert, Anchor, Button, Card, Code, Group, List, Stack, Text, TextInput, Title } from '@mantine/core';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PluginDetail } from '@deadair/sdk';

import { useFetcherAuthorization, useFinishFetcherAuthorization, useStartFetcherAuthorization } from '../../api/stream.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { StatusLamp } from '../shared/status.lamp';

/** The failure an operator can act on, rather than the status code that produced it. */
function startError(error: unknown, t: TFunction<'plugins'>): string {
    const status = sdkError(error)?.status;
    if (status === 403) return t('stream.startError.forbidden');
    if (status === 503) return t('stream.startError.notAnswering');
    return apiErrorMessage(error, t('stream.startError.fallback'));
}

/** The failure an operator can act on, rather than the status code that produced it. */
function finishError(error: unknown, t: TFunction<'plugins'>): string {
    const status = sdkError(error)?.status;
    if (status === 400) {
        return t('stream.finishError.badAddress', { message: apiErrorMessage(error, t('stream.finishError.badAddressFallback')) });
    }
    if (status === 502) return apiErrorMessage(error, t('stream.finishError.refused'));
    if (status === 503) return t('stream.finishError.notAnswering');
    return apiErrorMessage(error, t('stream.finishError.fallback'));
}

export interface StreamAuthorizationCardProps {
    plugin: PluginDetail;
}

/**
 * The station's own permission to play a record, which is not the same thing as the account link
 * above it.
 *
 * These are two credentials and an operator has every reason to think they are one. The connection
 * card signs the plugin in to the provider's API, which is what lists playlists and answers
 * searches. This one authorizes the station's TRACK FETCHER, a separate process that turns a record
 * into audio, and it needs a credential of its own: a token minted for the operator's own Spotify
 * app is minted for a different client, and the login the fetcher has to pass refuses it however
 * valid it is on its own terms. A station with only the first is one that lists playlists perfectly
 * and cannot fetch a single record.
 *
 * ## Why the operator has to paste an address
 *
 * Spotify returns the browser to a loopback address on the machine the fetcher is running on, and
 * that address cannot be changed: the client id belongs to the streaming client rather than to this
 * project, so loopback is the whole of what is on offer. Where the fetcher's port is published to
 * the machine the operator is sitting at — the development stack — the browser lands on it and the
 * authorization finishes itself. Everywhere else, including every ordinary install, the browser
 * lands on a page that cannot load.
 *
 * So the page failing to load is the expected outcome, and this card says so before it happens
 * rather than leaving an operator to read it as the failure it looks exactly like.
 */
export function StreamAuthorizationCard({ plugin }: StreamAuthorizationCardProps) {
    const { t } = useTranslation('plugins');
    const authorization = useFetcherAuthorization(plugin.enabled);
    const start = useStartFetcherAuthorization();
    const finish = useFinishFetcherAuthorization();
    const [pasted, setPasted] = useState('');

    const state = authorization.data;
    const authorizeUrl = start.data?.authorizeUrl ?? state?.pendingUrl;

    async function finishFromPasted(): Promise<void> {
        try {
            await finish.mutateAsync(pasted.trim());
            setPasted('');
            start.reset();
        } catch {
            // Reported from `finish.error` below, where the operator can still see what they pasted.
        }
    }

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Group justify="space-between" wrap="nowrap">
                        <Title order={3} size="h5">
                            {t('stream.title')}
                        </Title>
                        {state ? <StatusLamp {...lampFor(state, t)} /> : undefined}
                    </Group>
                    <Text size="sm" c="dimmed">
                        {t('stream.description', { name: plugin.name })}
                    </Text>
                </Stack>

                {!plugin.enabled ? (
                    <Text size="sm" c="dimmed">
                        {t('stream.enableFirst', { name: plugin.name })}
                    </Text>
                ) : undefined}

                {state?.configured === false ? (
                    <Alert color="gray" title={t('stream.notConfigured.title')}>
                        {t('stream.notConfigured.body')}
                    </Alert>
                ) : undefined}

                {state && state.configured && !state.reachable ? (
                    <Alert color="yellow" title={t('stream.unreachable.title')}>
                        {t('stream.unreachable.body')}
                    </Alert>
                ) : undefined}

                {state?.reachable && state.authorized ? <Text size="sm">{t('stream.authorized')}</Text> : undefined}

                {state?.reachable && !state.authorized ? (
                    <Alert color="yellow" title={t('stream.unauthorized.title')}>
                        {t('stream.unauthorized.body')}
                    </Alert>
                ) : undefined}

                {state?.loginError ? (
                    <Stack gap="xxs">
                        <Text size="sm" fw={500}>
                            {t('stream.lastLoginFailure')}
                        </Text>
                        <Code style={{ overflowWrap: 'anywhere' }}>{state.loginError}</Code>
                    </Stack>
                ) : undefined}

                {start.error ? <ErrorAlert title={t('stream.startError.title')}>{startError(start.error, t)}</ErrorAlert> : undefined}

                {authorizeUrl ? (
                    <Stack gap="sm">
                        <Alert color="blue" title={t('stream.steps.title')}>
                            <List size="sm" spacing="xs" type="ordered">
                                <List.Item>
                                    <Trans
                                        t={t}
                                        i18nKey="stream.steps.approve"
                                        components={{ anchor: <Anchor href={authorizeUrl} target="_blank" rel="noreferrer" /> }}
                                    />
                                </List.Item>
                                <List.Item>
                                    {state?.callbackUrl ? (
                                        <Trans
                                            t={t}
                                            i18nKey="stream.steps.sentTo"
                                            values={{ url: state.callbackUrl }}
                                            components={{ code: <Code /> }}
                                        />
                                    ) : (
                                        t('stream.steps.sentToStation')
                                    )}
                                </List.Item>
                                <List.Item>{t('stream.steps.paste')}</List.Item>
                            </List>
                        </Alert>

                        {finish.error ? <ErrorAlert title={t('stream.finishError.title')}>{finishError(finish.error, t)}</ErrorAlert> : undefined}

                        <TextInput
                            label={t('stream.pasteLabel')}
                            placeholder={t('stream.pastePlaceholder')}
                            value={pasted}
                            onChange={event => {
                                setPasted(event.currentTarget.value);
                            }}
                        />
                        <Group justify="flex-end">
                            <Button
                                loading={finish.isPending}
                                disabled={pasted.trim().length === 0}
                                onClick={() => {
                                    void finishFromPasted();
                                }}
                            >
                                {t('stream.finish')}
                            </Button>
                        </Group>
                    </Stack>
                ) : undefined}

                {finish.data ? (
                    <Text size="sm" c="teal">
                        {t('stream.fetchesAs', { username: finish.data.username })}
                    </Text>
                ) : undefined}

                <Group justify="flex-end">
                    <Button
                        variant="default"
                        loading={start.isPending}
                        disabled={!plugin.enabled || state?.configured === false || state?.reachable === false}
                        onClick={() => {
                            // Starting another replaces whichever was pending, so an operator who
                            // lost the link gets a fresh one rather than a refusal.
                            start.mutate();
                        }}
                    >
                        {authorizeUrl ? t('stream.startAgain') : state?.authorized ? t('stream.reauthorize') : t('stream.authorize')}
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}

/**
 * The one-word verdict, in the console's own status vocabulary.
 *
 * `fault` rather than `live` for an unauthorized fetcher: this is something broken that wants
 * fixing, not the station doing its job, and those two must never be drawn alike.
 */
function lampFor(
    state: { reachable: boolean; configured: boolean; authorized: boolean },
    t: TFunction<'plugins'>,
): {
    tone: 'ok' | 'fault' | 'standby' | 'off';
    label: string;
} {
    if (!state.configured) return { tone: 'off', label: t('stream.lamp.notSetUp') };
    if (!state.reachable) return { tone: 'standby', label: t('stream.lamp.notAnswering') };
    return state.authorized ? { tone: 'ok', label: t('stream.lamp.authorized') } : { tone: 'fault', label: t('stream.lamp.notAuthorized') };
}
