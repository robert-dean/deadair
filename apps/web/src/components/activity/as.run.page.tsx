import { useState } from 'react';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import type { AsRunEntry, AsRunKind } from '@deadair/sdk';

import { useAsRun } from '../../api/as.run.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ScriptLink, TrackLink } from '../shared/catalog.links';
import { FeedMoment } from '../shared/dated.feed';
import { FeedPage } from '../shared/feed.page';
import { formatDuration } from '../shared/format.duration';
import { PageHeader } from '../shared/page.header';
import { severityColor, toneColor } from '../shared/status';
import { dayjsClock } from '../../i18n/format.locale';

/**
 * Each kind's badge colour. Only a gap is painted as a fault, for the activity feed's reason: a break
 * airing is the station working, and a log in which everything is coloured has nothing to look for.
 * The air changes take the off tone, being the edges of a broadcast rather than things in it.
 */
const KIND_COLOR: Record<AsRunKind, string> = {
    record: 'gray',
    break: 'gray',
    programme: 'gray',
    gap: severityColor.failure,
    onAir: toneColor.off,
    offAir: toneColor.off,
};

const isItem = (entry: AsRunEntry): boolean => entry.kind === 'record' || entry.kind === 'break' || entry.kind === 'programme';

/**
 * What actually went out, in order, with times the operator can trust.
 *
 * The activity feed's neighbour, and a different grain of the same history: that one carries the
 * station's moments, this one carries every item as it went out, with how long it ran. The gaps and
 * the air changes are drawn between the items, because "nothing was on from 21:14 to 21:15" is a
 * line in the log rather than a fact somebody has to work out from two timestamps.
 *
 * An item with no end is one of two facts, and they are told apart by position: the newest item is
 * on air now, and any other open one is an item the station never saw end, which means it stopped
 * without being stood down.
 */
export function AsRunPage() {
    const { t } = useTranslation('activity');
    // Mantine's picker answers a local wall-clock string, which is the operator's own clock.
    const [until, setUntil] = useState<string | null>(null);
    const from = until === null ? undefined : DateTime.fromSQL(until);
    const log = useAsRun(from?.isValid ? from : undefined);

    const failure = log.isError ? apiErrorMessage(log.error, t('asRun.failure')) : undefined;
    const newestItem = log.data?.pages.flatMap(page => page.entries).find(isItem)?.id;

    return (
        <FeedPage
            query={log}
            itemsFrom={page => page.entries}
            failure={failure}
            emptyMessage={until === null ? t('asRun.empty.all') : t('asRun.empty.before')}
            renderRow={entry => <AsRunLine entry={entry} onAir={until === null && entry.id === newestItem} />}
        >
            <PageHeader
                title={t('asRun.title')}
                description={
                    <Text size="sm" c="dimmed">
                        {t('asRun.description')}
                    </Text>
                }
            />

            <DateTimePicker
                w={260}
                size="xs"
                label={t('asRun.until.label')}
                placeholder={t('asRun.until.placeholder')}
                valueFormat={`ddd D MMM, ${dayjsClock().time}`}
                timePickerProps={{ format: dayjsClock().picker }}
                maxDate={new Date()}
                clearable
                value={until}
                onChange={setUntil}
            />
        </FeedPage>
    );
}

/** One line: when, what kind, what it was, and how long it ran. */
function AsRunLine({ entry, onAir }: { entry: AsRunEntry; onAir: boolean }) {
    const { t } = useTranslation('activity');
    const item = isItem(entry);

    return (
        <Group gap="sm" wrap="nowrap" align="flex-start" px="md" py="xs">
            <FeedMoment at={entry.at} />

            <Badge size="xs" variant="light" color={KIND_COLOR[entry.kind]} tt="none" style={{ flexShrink: 0 }}>
                {t(`asRun.kind.${entry.kind}`)}
            </Badge>

            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" c={entry.kind === 'gap' ? severityColor.failure : undefined}>
                    {item ? entry.title : entry.detail}
                    {item && entry.artists ? (
                        <Text span size="sm" c="dimmed">
                            {' '}
                            {t('asRun.by', { artists: entry.artists })}
                        </Text>
                    ) : undefined}
                </Text>
                {/* The model's own words, set apart from the station's by being labelled as a reason and
                    drawn in italic. Only on a record the model picked while asked to say why. */}
                {entry.pickedBecause === undefined ? undefined : (
                    <Text size="xs" c="dimmed" fs="italic" title={t('asRun.pickedBecauseHint')}>
                        {t('asRun.pickedBecause', { reason: entry.pickedBecause })}
                    </Text>
                )}
                {entry.passedOver === undefined ? undefined : (
                    <Text size="xs" c={severityColor.warning}>
                        {t('asRun.passedOver', { count: entry.passedOver })}
                    </Text>
                )}
            </Stack>

            {item ? (
                <Text size="xs" c="dimmed" className="da-num" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {entry.endedAt !== undefined
                        ? formatDuration(entry.endedAt.toMillis() - entry.at.toMillis())
                        : onAir
                          ? t('asRun.onAirNow')
                          : t('asRun.noEnd')}
                </Text>
            ) : undefined}

            {entry.kind === 'record' && entry.trackId !== undefined ? (
                <TrackLink id={entry.trackId} size="xs" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {t('line.track')}
                </TrackLink>
            ) : undefined}
            {entry.kind !== 'record' && entry.segmentId !== undefined ? (
                <ScriptLink id={entry.segmentId} size="xs" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {t('line.script')}
                </ScriptLink>
            ) : undefined}
        </Group>
    );
}
