import { useState } from 'react';
import { Anchor, Button, Card, Code, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconRefresh } from '@tabler/icons-react';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';

import { isConnectivityError } from '../../api/api.status';
import { apiErrorMessage } from '../../api/sdk.error';

/**
 * The router's default error boundary: what a page shows when its loader threw.
 *
 * Without one, TanStack draws a bare message with no way forward, which made restarting the API
 * mid-session a dead end — the operator's only recovery was reloading the tab by hand.
 *
 * **The shell survives on its own here, and that is a property of where it lives.** In this console
 * the `AppShell` is the ROOT route's component and every page renders through its `Outlet`, so an
 * error in a child route replaces the page and leaves the header, the rail and the tally mounted.
 * (v1 kept a list of console paths to decide when to re-wrap the shell by hand; that list was a
 * consequence of its shell being per-page, and porting it here would be a second answer to a
 * question the layout already answers.) The root's own `beforeLoad` catches its failures rather
 * than throwing, so there is no case where this draws without chrome around it.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
    const router = useRouter();
    const [showDetail, setShowDetail] = useState(false);
    // The banner is already saying this, and saying it better, so the panel does not repeat the
    // countdown — it only stops blaming the page for something the whole origin is doing.
    const offline = isConnectivityError(error);

    // Both, and in this order. `reset` clears the boundary and `invalidate` re-runs the loaders
    // that threw; resetting alone re-renders straight back into the same failure.
    const retry = () => {
        reset();
        void router.invalidate();
    };

    return (
        <Card padding="xl" maw={560}>
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {offline ? 'This page could not be loaded' : 'This page did not load'}
                    </Title>
                    <Text c="dimmed" size="sm">
                        {offline
                            ? 'The station is not answering. It may be restarting — the console is already trying again.'
                            : apiErrorMessage(error, 'Something in this page failed while it was loading.')}
                    </Text>
                </Stack>

                <Group gap="sm">
                    <Button leftSection={<IconRefresh size={16} />} onClick={retry}>
                        Try again
                    </Button>
                    {/* `renderRoot` with the parameter annotated, never `component={Link}` — see
                        `apps/web/CLAUDE.md`: the polymorphic form spreads an `any` and silently
                        turns off route checking on the link. */}
                    <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} renderRoot={(props: object) => <Link to="/" {...props} />}>
                        Back to the desk
                    </Button>
                </Group>

                {/* Folded away: what somebody needs when reporting this, and noise every other
                    time.

                    An explicit toggle rather than Mantine's `Spoiler`, which decides whether to
                    offer its control by MEASURING the content against `maxHeight`. That reads well
                    and behaves badly here: every element measures zero height in a test
                    environment, so the control the operator's only route to the stack disappears
                    in exactly the place its absence goes unnoticed. A control that is always there
                    is also the honest shape — whether a stack is worth reading is not a question
                    about how tall it is.

                    Mounted only when asked for, rather than hidden with `Collapse`: this is a
                    stack trace, so there is nothing worth animating open and nothing worth keeping
                    in the tree while it is shut. */}
                <Stack gap="xxs">
                    <Anchor component="button" type="button" size="sm" onClick={() => setShowDetail(current => !current)}>
                        {showDetail ? 'Hide technical detail' : 'Show technical detail'}
                    </Anchor>
                    {showDetail ? (
                        <Code block style={{ whiteSpace: 'pre-wrap' }}>
                            {error.stack ?? error.message}
                        </Code>
                    ) : undefined}
                </Stack>
            </Stack>
        </Card>
    );
}
