import { Box, Card, Chip, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { TrackStateCounts } from '@deadair/sdk';

import type { TrackStateParam } from './catalog.page.params';

/**
 * The filters, in the order an operator reads them.
 *
 * `cached` and `unmeasured` first because they are the two distributions somebody actually comes
 * looking for — how much of the library is ready to air and how much the walk has got through —
 * and the two fault states last, where a zero is the good answer and reads as one.
 *
 * `count` picks the figure each chip is labelled with, and two of them are deliberately the
 * COMPLEMENT of the count the API sends: it reports what is cached and measured, because those are
 * the numbers worth reading as N of M, and the filters an operator wants are the ones that are not.
 */
const FILTERS: { state: TrackStateParam; label: string; help: string; count: (counts: TrackStateCounts) => number }[] = [
    {
        state: 'cached',
        label: 'On this machine',
        help: 'The audio is here, so these can be committed to the running order now.',
        count: counts => counts.cached,
    },
    {
        state: 'uncached',
        label: 'Not fetched',
        help: 'The station has not needed these yet. Ordinary for most of a library rather than a problem.',
        count: counts => counts.total - counts.cached,
    },
    {
        state: 'unmeasured',
        label: 'Unmeasured',
        help: 'No trustworthy measurement, so no cue points and no level decided before air. They still play.',
        count: counts => counts.total - counts.measured,
    },
    {
        state: 'failing',
        label: 'Failing',
        help: 'A fetch has failed and is backing off. Four in a row writes the copy off.',
        count: counts => counts.failing,
    },
    {
        state: 'benched',
        label: 'Benched',
        help: 'Every copy written off. These cannot air until a sync sees one of them again.',
        count: counts => counts.benched,
    },
];

export interface TrackStateFilterProps {
    counts?: TrackStateCounts;
    value: TrackStateParam | '';
    onChange: (state: TrackStateParam | '') => void;
}

/**
 * How much of the library is in each state, and a way to see just that part of it.
 *
 * The counts are the point and the filter is the affordance: "13 of 581 measured" was a `psql`
 * query before this, and it is the sentence both `docs/todo/analysis-queue-ordering.md` and
 * `docs/todo/provider-audio-failures.md` were written to answer.
 *
 * A chip with nothing behind it is drawn and disabled rather than hidden. Zero benched records is a
 * fact worth seeing — it is the difference between a healthy library and one nobody has asked about
 * — and a filter list that changed shape as the numbers moved would be unreadable.
 */
export function TrackStateFilter({ counts, value, onChange }: TrackStateFilterProps) {
    // Nothing to say until the first page has answered. Rendering an empty strip would push the
    // table down and then jump it back up.
    if (counts === undefined) return undefined;

    // The proportions the bar draws. Only the three that are a claim about readiness: what can air
    // now, what is here but unmeasured, and what has been written off. "Never needed yet" is the
    // rest and is drawn as the track behind them, because it is not a state so much as the absence
    // of one.
    const ready = counts.total === 0 ? 0 : (counts.cached / counts.total) * 100;
    const unmeasured = counts.total === 0 ? 0 : (Math.max(0, counts.cached - counts.measured) / counts.total) * 100;
    const benched = counts.total === 0 ? 0 : (counts.benched / counts.total) * 100;

    return (
        <Card withBorder padding="md">
            <Stack gap="xs">
                {/* The sentence first, because it is what an operator came for. Five chips each
                    holding a number made the reader do the division: the question is never "how
                    many are cached", it is "how much of my library can go out right now". */}
                <Group justify="space-between" align="baseline" gap="md" wrap="wrap">
                    <Text size="sm">
                        <span className="da-num" style={{ fontWeight: 600 }}>
                            {counts.cached.toLocaleString()}
                        </span>{' '}
                        of <span className="da-num">{counts.total.toLocaleString()}</span> records are ready to air right now.
                    </Text>
                    <Text size="xs" c="dimmed">
                        The rest are fetched when the station wants them.
                    </Text>
                </Group>

                <Group gap={0} h={8} style={{ borderRadius: 4, overflow: 'hidden', background: 'var(--da-border)' }} aria-hidden>
                    <Box w={`${ready}%`} h="100%" bg="teal.4" />
                    <Box w={`${unmeasured}%`} h="100%" bg="yellow.4" />
                    <Box w={`${benched}%`} h="100%" bg="orange.4" />
                </Group>

                {/* The chips keep their whole job as filters, and lose only the arithmetic. A chip
                    with nothing behind it stays drawn and disabled: zero benched records is a fact
                    worth seeing, and a list that changed shape as the numbers moved would be
                    unreadable. */}
                <Group gap="xs" align="center">
                    {FILTERS.map(filter => {
                        const count = filter.count(counts);
                        return (
                            <Tooltip key={filter.state} label={filter.help} multiline w={260}>
                                <Chip
                                    size="xs"
                                    checked={value === filter.state}
                                    disabled={count === 0 && value !== filter.state}
                                    onChange={checked => {
                                        onChange(checked ? filter.state : '');
                                    }}
                                >
                                    <span className="da-num">{count.toLocaleString()}</span> {filter.label}
                                </Chip>
                            </Tooltip>
                        );
                    })}
                </Group>
            </Stack>
        </Card>
    );
}
