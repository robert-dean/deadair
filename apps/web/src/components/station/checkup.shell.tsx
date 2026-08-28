import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';

import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';

export const CHECKUP_TABS = [
    { key: 'machinery', label: 'Machinery' },
    { key: 'history', label: 'What it has been doing' },
    { key: 'cost', label: 'What it cost' },
] as const satisfies readonly DestinationTab<string>[];

export type CheckupTab = (typeof CHECKUP_TABS)[number]['key'];

/** Where each tab goes, so the palette and the tab strip cannot disagree about it. */
export const CHECKUP_ROUTES: Record<CheckupTab, '/checkup' | '/activity' | '/traces'> = {
    machinery: '/checkup',
    history: '/activity',
    cost: '/traces',
};

export interface CheckupShellProps {
    active: CheckupTab;
    children: ReactNode;
}

/**
 * The machinery, what the station has been doing, and what that cost.
 *
 * Three nav links that were one question asked in three tenses. Check-up says what the machinery is
 * doing NOW — five loops turning, six of nine plugins up — the activity feed says what it DID, and
 * the traces say what each decision spent doing it. An operator who finds a stalled loop on the
 * first page immediately wants the second, and one who finds a warning there wants the third.
 *
 * Separate routes rather than a search param, unlike Voice: each carries its own filters and its own
 * scroll or drawer state, and there is nothing to gain by moving that into a sibling's query string.
 * The tab strip navigates between them.
 */
export function CheckupShell({ active, children }: CheckupShellProps) {
    const navigate = useNavigate();

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Title order={1}>Check-up</Title>
                <Text size="sm" c="dimmed" maw={720}>
                    The machinery, what the station has been doing, and what that cost. Nothing here probes it: every figure is a reading it was
                    already keeping.
                </Text>
            </Stack>

            <DestinationTabs
                tabs={CHECKUP_TABS}
                active={active}
                label="Check-up"
                onSelect={key => {
                    void navigate({ to: CHECKUP_ROUTES[key] });
                }}
            />

            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}
