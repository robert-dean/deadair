import { Anchor, Card, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';

import type { PluginOAuthOutcome } from '../../api/plugins.queries';
import { ErrorAlert } from '../shared/error.alert';

export interface PluginOAuthCallbackPageProps {
    id: string;
    outcome: PluginOAuthOutcome;
}

/**
 * Where the provider sends the operator back to.
 *
 * The exchange itself happens in the route's loader, so this only reports it. The API's failure
 * sentence is deliberately neutral — a prober must not be able to tell a bad `state` from a bad
 * code — so it is repeated rather than interpreted.
 */
export function PluginOAuthCallbackPage({ id, outcome }: PluginOAuthCallbackPageProps) {
    const { result, failure } = outcome;
    const message = failure ?? (result?.ok ? undefined : (result?.message ?? 'The authorization could not be completed.'));

    return (
        <Card padding="xl" maw={560}>
            <Stack gap="md">
                <Title order={2} size="h4">
                    Authorization
                </Title>

                {message === undefined ? (
                    <Text c="teal">Connected. The plugin has stored its tokens.</Text>
                ) : (
                    <ErrorAlert title="Not connected">{message}</ErrorAlert>
                )}

                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={(props: object) => <Link to="/plugins/$id" params={{ id }} {...props} />} size="sm">
                    Back to the plugin
                </Anchor>
            </Stack>
        </Card>
    );
}
