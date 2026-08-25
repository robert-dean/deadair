import { useState } from 'react';
import { Alert, Anchor, Button, Card, Code, Group, List, Stack, Text, TextInput, Title } from '@mantine/core';
import type { PluginDetail } from '@deadair/sdk';

import { useFetcherAuthorization, useFinishFetcherAuthorization, useStartFetcherAuthorization } from '../../api/stream.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { StatusLamp } from '../shared/status.lamp';

/** The failure an operator can act on, rather than the status code that produced it. */
function startError(error: unknown): string {
    const status = sdkError(error)?.status;
    if (status === 403) return 'Authorizing playback is not something your account is allowed to do.';
    if (status === 503)
        return 'The track fetcher is not answering, so there is nothing to authorize yet. Check that the stream half of this install is running.';
    return apiErrorMessage(error, 'The authorization could not be started.');
}

/** The failure an operator can act on, rather than the status code that produced it. */
function finishError(error: unknown): string {
    const status = sdkError(error)?.status;
    if (status === 400) {
        return apiErrorMessage(error, 'That address could not be used.') + ' Start the authorization again and use the new link.';
    }
    if (status === 502) return apiErrorMessage(error, 'Spotify refused the exchange. This is worth trying again in a moment.');
    if (status === 503) return 'The track fetcher is not answering, so the authorization could not be finished.';
    return apiErrorMessage(error, 'The authorization could not be finished.');
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
                            Playback authorization
                        </Title>
                        {state ? <StatusLamp {...lampFor(state)} /> : undefined}
                    </Group>
                    <Text size="sm" c="dimmed">
                        Separate from the connection above, and needed as well as it. That one lets {plugin.name} read your library; this one lets the
                        station fetch the audio. You do this once.
                    </Text>
                </Stack>

                {!plugin.enabled ? (
                    <Text size="sm" c="dimmed">
                        Enable {plugin.name} to see whether the station can fetch its audio.
                    </Text>
                ) : undefined}

                {state?.configured === false ? (
                    <Alert color="gray" title="No track fetcher on this install">
                        The stream half of this install has not been set up, so there is nothing here to authorize yet.
                    </Alert>
                ) : undefined}

                {state && state.configured && !state.reachable ? (
                    <Alert color="yellow" title="The track fetcher is not answering">
                        Nothing can be authorized until it is running. This is not the same as the station never having been authorized, so nothing
                        below has been lost.
                    </Alert>
                ) : undefined}

                {state?.reachable && state.authorized ? (
                    <Text size="sm">
                        The station holds its own Spotify authorization. Redo it only if the fetcher has started refusing logins, or to move the
                        station to a different Spotify account.
                    </Text>
                ) : undefined}

                {state?.reachable && !state.authorized ? (
                    <Alert color="yellow" title="The station cannot fetch any audio yet">
                        Without this, every record is dropped from the running order for want of audio, however healthy the connection above looks.
                    </Alert>
                ) : undefined}

                {state?.loginError ? (
                    <Stack gap="xxs">
                        <Text size="sm" fw={500}>
                            Last login failure
                        </Text>
                        <Code style={{ overflowWrap: 'anywhere' }}>{state.loginError}</Code>
                    </Stack>
                ) : undefined}

                {start.error ? <ErrorAlert title="Could not start the authorization">{startError(start.error)}</ErrorAlert> : undefined}

                {authorizeUrl ? (
                    <Stack gap="sm">
                        <Alert color="blue" title="The page you land on will not load. That is expected">
                            <List size="sm" spacing="xs" type="ordered">
                                <List.Item>
                                    <Anchor href={authorizeUrl} target="_blank" rel="noreferrer">
                                        Open the Spotify approval page
                                    </Anchor>{' '}
                                    and approve.
                                </List.Item>
                                <List.Item>
                                    Your browser is then sent to {state?.callbackUrl ? <Code>{state.callbackUrl}</Code> : 'an address on the station'}
                                    , which is only reachable from the station itself. Expect an error page.
                                </List.Item>
                                <List.Item>Copy that whole address out of the address bar and paste it below.</List.Item>
                            </List>
                        </Alert>

                        {finish.error ? <ErrorAlert title="Could not finish the authorization">{finishError(finish.error)}</ErrorAlert> : undefined}

                        <TextInput
                            label="The address you were sent to"
                            placeholder="http://127.0.0.1:3679/login?code=…&state=…"
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
                                Finish
                            </Button>
                        </Group>
                    </Stack>
                ) : undefined}

                {finish.data ? (
                    <Text size="sm" c="teal">
                        The station now fetches as {finish.data.username}.
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
                        {authorizeUrl ? 'Start again' : state?.authorized ? 'Re-authorize' : 'Authorize'}
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
function lampFor(state: { reachable: boolean; configured: boolean; authorized: boolean }): {
    tone: 'ok' | 'fault' | 'standby' | 'off';
    label: string;
} {
    if (!state.configured) return { tone: 'off', label: 'Not set up' };
    if (!state.reachable) return { tone: 'standby', label: 'Not answering' };
    return state.authorized ? { tone: 'ok', label: 'Authorized' } : { tone: 'fault', label: 'Not authorized' };
}
