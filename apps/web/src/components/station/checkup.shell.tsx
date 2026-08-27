import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';

import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';

const CHECKUP_TABS = [
    { key: 'machinery', label: 'Machinery' },
    { key: 'history', label: 'What it has been doing' },
] as const satisfies readonly DestinationTab<string>[];

export type CheckupTab = (typeof CHECKUP_TABS)[number]['key'];

export interface CheckupShellProps {
    active: CheckupTab;
    children: ReactNode;
}

/**
 * The machinery, and what the station has been doing.
 *
 * Two nav links that were one question asked twice. Check-up says what the machinery is doing NOW —
 * five loops turning, six of nine plugins up — and the activity feed says what it DID. An operator
 * who finds a stalled loop on the first page immediately wants the second, and had to go find it.
 *
 * Two routes rather than a search param, unlike Voice: the feed carries its own module and severity
 * filters in the URL and its own infinite scroll, and there is nothing to gain by moving that into
 * a sibling's query string. The tab strip navigates between them.
 */
export function CheckupShell({ active, children }: CheckupShellProps) {
    const navigate = useNavigate();

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Title order={1}>Check-up</Title>
                <Text size="sm" c="dimmed" maw={720}>
                    The machinery, and what the station has been doing. Nothing here probes it: every figure is a reading it was already keeping.
                </Text>
            </Stack>

            <DestinationTabs
                tabs={CHECKUP_TABS}
                active={active}
                label="Check-up"
                onSelect={key => {
                    void navigate({ to: key === 'machinery' ? '/checkup' : '/activity' });
                }}
            />

            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}
