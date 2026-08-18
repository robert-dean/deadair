import { useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { Production } from '@deadair/sdk';

import { useCancelProduction, useProductions, useRequestProduction } from '../../api/productions.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { toneColor, type StatusTone } from '../shared/status';
import { ProductionForm } from './production.form';

/**
 * What the station is making, as against what it is saying.
 *
 * A production is several beats of speech written over minutes to hours, so this page is mostly
 * about WAITING well: an operator asks for one, and the useful thing the console can then do is say
 * honestly how far along it is and offer to stop it.
 *
 * Two things it deliberately does not do. It does not show the script — that is what the Scripts
 * page is for, and a page that showed both would be two answers to "what did the station say". And
 * it does not stream progress: a pass is minutes long and there is no event to listen to, so it
 * polls, which is the honest shape for information that changes this slowly.
 */
export function ProductionsPage() {
    const productions = useProductions();
    const request = useRequestProduction();
    const cancel = useCancelProduction();

    const [asking, setAsking] = useState(false);

    const close = () => {
        setAsking(false);
        request.reset();
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Productions"
                description="Programmes the station writes for itself: several beats of speech, made over minutes and aired as one block. Asking for one queues it — nothing is made while you wait, and it goes into the running order once every beat has been spoken."
                actions={
                    !asking && (
                        <Button onClick={() => setAsking(true)} disabled={productions.isLoading}>
                            Ask for one
                        </Button>
                    )
                }
            />

            {asking && (
                <ProductionForm
                    pending={request.isPending}
                    error={request.error}
                    onCancel={close}
                    onSubmit={body => request.mutate(body, { onSuccess: close })}
                />
            )}

            {productions.isError && <ErrorAlert title="Could not read what the station is making" error={productions.error} />}
            {cancel.isError && <ErrorAlert title="Could not stop that production" error={cancel.error} />}

            {productions.isLoading && <PageSkeleton variant="rows" />}

            {productions.data?.productions.length === 0 && !asking && (
                <EmptyState title="The station has not made anything yet">
                    Ask for one above, or put a line like <code>21:00 podcast</code> on the station clock and one is commissioned ahead of every slot.
                </EmptyState>
            )}

            <Stack gap="sm">
                {productions.data?.productions.map(production => (
                    <ProductionCard
                        key={production.id}
                        production={production}
                        stopping={cancel.isPending && cancel.variables === production.id}
                        onCancel={() => cancel.mutate(production.id)}
                    />
                ))}
            </Stack>
        </Stack>
    );
}

/**
 * When a scheduled production is due, to the minute.
 *
 * The same shape the catalog's detail page uses, and it has to be built here rather than taken from
 * a `DateTime`: the SDK hands the console an ISO string, because `apps/web` carries no luxon and the
 * JSON-safe boundary specifies strings.
 */
const MOMENT = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const moment = (iso: string): string => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? '—' : MOMENT.format(at);
};

/** One production, and how far along it is. */
function ProductionCard({ production, stopping, onCancel }: { production: Production; stopping: boolean; onCancel: () => void }) {
    return (
        <Card>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap="xxs">
                    <Group gap="xs">
                        <Text fw={600}>{production.title}</Text>
                        <Badge color={toneColor[toneOf(production.state)]} variant="light">
                            {labelOf(production)}
                        </Badge>
                        <Badge variant="default">{production.kind}</Badge>
                    </Group>

                    {production.brief !== undefined && (
                        <Text size="sm" c="dimmed">
                            {production.brief}
                        </Text>
                    )}

                    <Text size="sm" c="dimmed">
                        {describe(production)}
                    </Text>

                    {production.error !== undefined && (
                        <Text size="sm" c={toneColor.fault}>
                            {production.error}
                        </Text>
                    )}
                </Stack>

                {canStop(production.state) && (
                    <Button variant="subtle" color="red" onClick={onCancel} loading={stopping}>
                        Stop
                    </Button>
                )}
            </Group>
        </Card>
    );
}

/**
 * Whether stopping this is still a thing that can happen.
 *
 * The same three terminal states the API refuses, mirrored here so the button is absent rather than
 * present-and-rejected. It is a mirror rather than the authority: the API decides, because a
 * production can settle between the poll and the click.
 */
const canStop = (state: Production['state']) => state !== 'aired' && state !== 'failed' && state !== 'cancelled';

/**
 * How a state reads, in the console's own five tones.
 *
 * `aired` is `ok` rather than `live`: it means the block went into the running order, which is not
 * the same as it being on air this second, and the `live` tone is reserved for things that genuinely
 * are.
 */
function toneOf(state: Production['state']): StatusTone {
    if (state === 'failed') return 'fault';
    if (state === 'cancelled') return 'off';
    if (state === 'aired') return 'ok';
    if (state === 'planned') return 'standby';
    return 'live';
}

/** What the badge says. Plain words rather than the state name, which is the machine's vocabulary. */
function labelOf(production: Production): string {
    switch (production.state) {
        case 'planned':
            return 'queued';
        case 'outlining':
            return 'planning it';
        case 'drafting':
            return 'writing it';
        case 'checking':
            return 'checking it';
        case 'rendering':
            return 'speaking it';
        case 'ready':
            return 'ready';
        case 'aired':
            return 'in the running order';
        case 'failed':
            return 'failed';
        case 'cancelled':
            return 'stopped';
    }
}

/**
 * The line under the title: how long it will run, how much of it exists, and when it is due.
 *
 * The beat count is the honest progress indicator, and the only one there is — a pass does not
 * report a percentage and inventing one would be a bar that moves at random.
 */
function describe(production: Production): string {
    const parts = [`about ${Math.round(production.targetMs / 60_000)} minutes`, `${production.writingMode} write`];

    if (production.beats > 0) parts.push(`${production.beats} ${production.beats === 1 ? 'beat' : 'beats'} written`);
    if (production.scheduledFor !== undefined) parts.push(`due ${moment(production.scheduledFor)}`);

    return parts.join(' · ');
}
