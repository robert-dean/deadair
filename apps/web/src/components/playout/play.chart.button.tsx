import { Button, Group, Select, Stack, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import type { PlayoutChartInput } from '@deadair/sdk';

import { usePlayChart } from '../../api/playout.queries';
import { apiErrorMessage } from '../../api/sdk.error';

type ChartOrder = NonNullable<PlayoutChartInput['chartOrder']>;

export interface PlayChartButtonProps {
    /** The qualified `pluginId:chartId` this page is showing. */
    chartId: string;
    /** False when the chart came back with nothing on it, which the API refuses. */
    playable?: boolean;
}

/**
 * Which way round the chart is played, offered because the answer is a matter of taste.
 *
 * A countdown is the shape a chart show has on the radio, so it leads and it is the default. The
 * other two are here because neither is wrong: an operator who wants the biggest record first has
 * asked for the published document, and one who wants none of it is asking for the station's
 * ordinary sequencing over the chart's records.
 */
const ORDERS: { value: ChartOrder; label: string }[] = [
    { value: 'countdown', label: 'Countdown, ending on number one' },
    { value: 'ranked', label: 'Number one first' },
    { value: 'unordered', label: 'No fixed order' },
];

/**
 * Puts the station on air with a published chart's records.
 *
 * A broadcast action, not a preview, and the same one {@link PlayPlaylistButton} performs: it
 * replaces whatever was queued and goes out over the mount to every listener. "Air" rather than
 * "Play" for that reason — nothing here plays audio in the browser.
 *
 * ## What a chart costs that a playlist does not
 *
 * A playlist names copies the station can already fetch. A chart names RECORDS, so airing one has
 * the station look each entry up at a provider and ingest it, and those arrive unmeasured — they
 * air untrimmed until the analysis pass reaches them. That is said under the button rather than
 * left to be heard, because it is the one surprise in pressing it.
 *
 * ## The press is an ASK, and the copy says so
 *
 * Those lookups are why: a chart is up to a hundred records and each miss is a search across every
 * provider, so the API queues the work and answers immediately rather than holding the request open
 * for minutes. The station changes over when the job has an order, which the transport bar picks up
 * on its own poll — there is nothing for this component to wait on.
 *
 * So a green press means "asked", not "on air", and the second line says which. The failures an
 * operator can act on are still raised here, because the API refuses them at the door before it
 * queues anything: an id naming no chart, and a chart nothing could read. The third one — nothing
 * on it can be played — cannot be known without the lookups, so it lands on the activity feed and
 * is deliberately NOT faked into a button state that would have to lie about when it knew.
 */
export function PlayChartButton({ chartId, playable = true }: PlayChartButtonProps) {
    const play = usePlayChart();
    // Local, and deliberately not a setting: it is a property of the broadcast somebody is about to
    // start rather than of the station, in the same way a brief is.
    const [order, setOrder] = useState<ChartOrder>('countdown');

    if (!playable) {
        return undefined;
    }

    // Kept on the button rather than raised as a page-level alert, as the playlist one is: the
    // failure belongs to this action, and the transport bar reports the station's own state
    // whether or not this request landed.
    const failure = play.isError ? apiErrorMessage(play.error, 'That chart could not be aired.') : undefined;

    return (
        <Stack gap={4}>
            <Group gap="xs" align="flex-end" wrap="nowrap">
                <Select
                    aria-label="Which way round to play the chart"
                    data={ORDERS}
                    value={order}
                    onChange={value => setOrder((value as ChartOrder | null) ?? 'countdown')}
                    allowDeselect={false}
                    size="sm"
                    w={260}
                />
                <Tooltip label={failure} disabled={!failure} color="red" multiline maw={320}>
                    <Button
                        variant="light"
                        color={failure ? 'red' : undefined}
                        loading={play.isPending}
                        onClick={() => play.mutate({ chartId, chartOrder: order })}
                    >
                        {failure ? 'Failed' : 'Air this chart'}
                    </Button>
                </Tooltip>
            </Group>
            <Text size="xs" c="dimmed">
                Records the library has never held are fetched as they are needed, and air untrimmed until they have been measured. Looking a whole
                chart up takes a few minutes, so the station changes over once it has, and the feed says how it went.
            </Text>
        </Stack>
    );
}
