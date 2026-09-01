import { Box, Button, Group, Text } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

import { useApiStatus } from '../../api/api.status';
import { ErrorAlert } from './error.alert';
import { severityColor } from './status';

/**
 * The one place the console says the server is gone.
 *
 * Drawn across the top of the shell rather than in place of it: the nav, the header and every list
 * that loaded before the API went away all stay put, so an operator can keep reading what they were
 * looking at while it comes back. The alternative — which is what happens without this — is that
 * each page independently discovers the same failure and says so in its own words, and none of them
 * mentions that the whole origin is down or that the console is retrying on its own.
 *
 * `warning` rather than `failure`, deliberately. Nothing has broken and nothing was lost; the
 * console is stale and is already doing something about it. Red is reserved for the failures an
 * operator has to act on, and this one recovers by itself the moment the API answers.
 */
export function ApiStatusBanner() {
    const { reachable, retryInSeconds, checking, retryNow } = useApiStatus();
    if (reachable) {
        return undefined;
    }

    // The gap belongs to the banner rather than to a wrapper in the shell, so that nothing holds a
    // margin open on the overwhelming majority of renders where this draws nothing.
    return (
        <Box mb="lg">
            <ErrorAlert tone="warning" title="Can't reach the station">
                <Group justify="space-between" wrap="wrap" gap="sm">
                    {/* Polite rather than assertive: the countdown rewrites this node every second,
                        and an assertive region would have a screen reader announce each tick over
                        whatever the operator was actually doing. */}
                    <Text size="sm" role="status" aria-live="polite">
                        Anything on screen may be out of date. {checking ? 'Trying now…' : `Trying again in ${retryInSeconds}s.`}
                    </Text>
                    {/* The alert's own tone, read from the same table it is: a button that named
                        its colour inline would be the exact drift `status.ts` exists to prevent. */}
                    <Button
                        variant="light"
                        color={severityColor.warning}
                        size="compact-sm"
                        leftSection={<IconRefresh size={14} />}
                        loading={checking}
                        onClick={retryNow}
                    >
                        Try now
                    </Button>
                </Group>
            </ErrorAlert>
        </Box>
    );
}
