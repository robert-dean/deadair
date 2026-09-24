import { useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core';
import type { Production } from '@deadair/sdk';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { useCancelProduction, useProductions, useRequestProduction } from '../../api/productions.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { formatMomentMinute, type Moment } from '../shared/feed.moment';
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
    const { t } = useTranslation('productions');
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
                title={t('title')}
                description={t('description')}
                actions={
                    !asking && (
                        <Button onClick={() => setAsking(true)} disabled={productions.isLoading}>
                            {t('ask')}
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

            {productions.isError && <ErrorAlert title={t('error.list')} error={productions.error} />}
            {cancel.isError && <ErrorAlert title={t('error.cancel')} error={cancel.error} />}

            {productions.isLoading && <PageSkeleton variant="rows" />}

            {productions.data?.productions.length === 0 && !asking && (
                <EmptyState title={t('empty.title')}>
                    <Trans t={t} i18nKey="empty.body" components={{ code: <code /> }} />
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
 * Who is on a production: the presenter, and whoever was cast to ring in.
 *
 * Only drawn where there IS somebody else, since a cast of one is every production the station made
 * before callers and saying "presented by" on all of them is a line that reads the same on every
 * card. A member with no name is one whose station is presenting as nobody in particular.
 */
function cast(production: Production, t: TFunction<'productions'>): string {
    const named = (role: 'host' | 'caller'): string[] =>
        production.cast.filter(member => member.role === role).flatMap(member => (member.name === undefined ? [] : [member.name]));

    const callers = named('caller');
    const host = named('host')[0];

    const names = callers.join(t('cast.joiner'));
    if (host !== undefined && callers.length > 0) return t('cast.hostWithCallers', { host, callers: names });
    if (host !== undefined) return t('cast.host', { host });
    if (callers.length > 0) return t('cast.callers', { callers: names });
    return t('cast.voices', { count: production.cast.length });
}

/**
 * When a scheduled production is due, to the minute, and carrying its weekday because a production
 * can be commissioned days out.
 */
const moment = (iso: Moment): string => formatMomentMinute(iso, { weekday: true, fallback: '—' });

/** One production, and how far along it is. */
function ProductionCard({ production, stopping, onCancel }: { production: Production; stopping: boolean; onCancel: () => void }) {
    const { t } = useTranslation('productions');
    return (
        <Card>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap="xxs">
                    <Group gap="xs">
                        <Text fw={600}>{production.title}</Text>
                        <Badge color={toneColor[toneOf(production.state)]} variant="light">
                            {t(`state.${production.state}`)}
                        </Badge>
                        <Badge variant="default">{production.kind}</Badge>
                    </Group>

                    {production.brief !== undefined && (
                        <Text size="sm" c="dimmed">
                            {production.brief}
                        </Text>
                    )}

                    <Text size="sm" c="dimmed">
                        {describe(production, t)}
                    </Text>

                    {/* Who is on it, which is the answer to "why was there somebody else in that
                        programme". Drawn from the stored cast rather than from the personas page,
                        because the character may have been edited since it was written. */}
                    {production.cast.length > 1 && (
                        <Text size="xs" c="dimmed">
                            {cast(production, t)}
                        </Text>
                    )}

                    {production.error !== undefined && (
                        <Text size="sm" c={toneColor.fault}>
                            {production.error}
                        </Text>
                    )}
                </Stack>

                {canStop(production.state) && (
                    <Button variant="subtle" color="red" onClick={onCancel} loading={stopping}>
                        {t('stop')}
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

/**
 * The line under the title: how long it will run, how much of it exists, and when it is due.
 *
 * The beat count is the honest progress indicator, and the only one there is — a pass does not
 * report a percentage and inventing one would be a bar that moves at random.
 */
function describe(production: Production, t: TFunction<'productions'>): string {
    const parts: string[] = [
        t('describe.minutes', { count: Math.round(production.targetMs / 60_000) }),
        t('describe.mode', { mode: production.writingMode }),
    ];

    if (production.beats > 0) parts.push(t('describe.beats', { count: production.beats }));
    if (production.scheduledFor !== undefined) parts.push(t('describe.due', { when: moment(production.scheduledFor) }));

    return parts.join(' · ');
}
