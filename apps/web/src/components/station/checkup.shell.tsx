import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';

import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';

export const CHECKUP_TABS = [
    { key: 'machinery', label: 'Machinery' },
    { key: 'history', label: 'What it has been doing' },
    { key: 'cost', label: 'What it cost' },
    { key: 'logs', label: 'Logs' },
] as const satisfies readonly DestinationTab<string>[];

export type CheckupTab = (typeof CHECKUP_TABS)[number]['key'];

/** Where each tab goes, so the palette and the tab strip cannot disagree about it. */
export const CHECKUP_ROUTES: Record<CheckupTab, '/checkup' | '/activity' | '/traces' | '/logs'> = {
    machinery: '/checkup',
    history: '/activity',
    cost: '/traces',
    logs: '/logs',
};

export interface CheckupShellProps {
    active: CheckupTab;
    children: ReactNode;
}

/**
 * The machinery, what the station has been doing, what that cost, and the raw record underneath.
 *
 * The first three are one question asked in three tenses. Check-up says what the machinery is doing
 * NOW — five loops turning, six of nine plugins up — the activity feed says what it DID, and the
 * traces say what each decision spent doing it. An operator who finds a stalled loop on the first
 * page immediately wants the second, and one who finds a warning there wants the third.
 *
 * Logs is not a fourth tense. The other three are the station's own account of itself, composed and
 * worded; this is what the processes actually wrote, including the two that are not the station at
 * all. It is where somebody ends up when the composed answer was not enough, which is why it is last
 * rather than first.
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
                {/* What the four tabs are, and nothing else. The second sentence this used to carry
                    — that nothing here probes the station — is the Machinery tab's own opening line,
                    almost word for word, and the two were drawn one above the other. */}
                <Text size="sm" c="dimmed" maw={720}>
                    The machinery, what the station has been doing, what that cost, and the logs underneath.
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
