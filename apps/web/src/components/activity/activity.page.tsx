import { useState } from 'react';
import { Badge, Group, SegmentedControl, Text } from '@mantine/core';
import type { ActivityEntry, ActivityModule, ActivitySeverity } from '@deadair/sdk';

import { useActivity } from '../../api/activity.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ScriptLink, TrackLink } from '../shared/catalog.links';
import { FeedMoment } from '../shared/dated.feed';
import { FeedPage } from '../shared/feed.page';
import { PageHeader } from '../shared/page.header';
import { severityColor } from '../shared/status';

/** The filter chips, and the order an operator meets them: what airs first, what makes it after. */
const MODULES: { value: ActivityModule | 'all'; label: string }[] = [
    { value: 'all', label: 'Everything' },
    { value: 'playout', label: 'Playout' },
    { value: 'director', label: 'Programming' },
    { value: 'render', label: 'Breaks' },
    { value: 'catalog', label: 'Catalog' },
    { value: 'plugins', label: 'Plugins' },
];

const SEVERITIES: { value: ActivitySeverity | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'warn', label: 'Warnings' },
    { value: 'fault', label: 'Faults' },
];

/**
 * How a line is painted, which is the one colour on this page that is not decorative.
 *
 * `info` is left alone: most of a feed is ordinary and painting it would leave nothing for the two
 * that matter to stand out against. The other two go through `severityColor` rather than naming a
 * hue, because this was a nested ternary spelling `red` and `yellow` inline — exactly the surface
 * deciding for itself that its problem is a bit red that `shared/status.ts` opens by forbidding.
 */
const SEVERITY_COLOR: Record<ActivitySeverity, string | undefined> = {
    info: undefined,
    warn: severityColor.warning,
    fault: severityColor.failure,
};

/** A Mantine palette name per module, so a scan reads where a line came from without reading it. */
const MODULE_COLOR: Record<ActivityModule, string> = {
    playout: 'blue',
    director: 'grape',
    render: 'teal',
    catalog: 'gray',
    plugins: 'gray',
};

/**
 * What the station has been doing.
 *
 * Three sources behind one list: the station's own moments, a break's journey from planned to
 * ready, and the records that actually aired. The API unions them; this only draws them.
 *
 * **`info` is not a colour.** A station idling for want of a listener writes an `info` line and so
 * does a record airing, because a station waiting on purpose is not a fault — the same argument the
 * `ready` badge on the transport strip exists on. Only `warn` and `fault` are painted, which is what
 * makes them worth looking for.
 */
export function ActivityPage() {
    const [module, setModule] = useState<ActivityModule | 'all'>('all');
    const [severity, setSeverity] = useState<ActivitySeverity | 'all'>('all');

    const feed = useActivity({ ...(module === 'all' ? {} : { module }), ...(severity === 'all' ? {} : { minSeverity: severity }) }, true);

    const failure = feed.isError ? apiErrorMessage(feed.error, 'The activity feed could not be read.') : undefined;

    return (
        <FeedPage
            query={feed}
            itemsFrom={page => page.entries}
            failure={failure}
            emptyMessage={
                module === 'all' && severity === 'all'
                    ? 'Nothing yet. The station writes here as it airs records, makes breaks and changes what it is doing.'
                    : 'Nothing matches that filter.'
            }
            renderRow={entry => <ActivityLine entry={entry} />}
        >
            <PageHeader
                title="Activity"
                description={
                    <Text size="sm" c="dimmed">
                        What the station has done, newest first: what aired, what it wrote and spoke, and every moment a gate opened or closed on it.
                    </Text>
                }
            />

            <Group gap="md" wrap="wrap">
                <SegmentedControl
                    size="xs"
                    data={MODULES}
                    value={module}
                    onChange={value => {
                        setModule(value as ActivityModule | 'all');
                    }}
                />
                <SegmentedControl
                    size="xs"
                    data={SEVERITIES}
                    value={severity}
                    onChange={value => {
                        setSeverity(value as ActivitySeverity | 'all');
                    }}
                />
            </Group>
        </FeedPage>
    );
}

/**
 * One line, and the way into whatever it is about.
 *
 * The sentence is left exactly as the API composed it and is never parsed for a title: the link is
 * a separate trailing affordance built from the ids the row already carries. A line about neither
 * carries neither, which is most of the feed — a gate opening is about the station itself.
 */
function ActivityLine({ entry }: { entry: ActivityEntry }) {
    return (
        <Group gap="sm" wrap="nowrap" align="flex-start" px="md" py="xs">
            <FeedMoment at={entry.at} />

            <Badge size="xs" variant="light" color={MODULE_COLOR[entry.module]} tt="none" style={{ flexShrink: 0 }}>
                {entry.module}
            </Badge>

            <Text size="sm" c={SEVERITY_COLOR[entry.severity]} style={{ minWidth: 0 }}>
                {entry.detail}
            </Text>

            {/* The record first: an entry carrying both is about a break that named one, and what
                an operator reading the feed wants from that line is the words. */}
            {entry.segmentId === undefined ? undefined : (
                <ScriptLink id={entry.segmentId} size="xs" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    what was said
                </ScriptLink>
            )}
            {entry.trackId === undefined ? undefined : (
                <TrackLink id={entry.trackId} size="xs" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    the record
                </TrackLink>
            )}
        </Group>
    );
}
