import { Card, Chip, Group, Progress, Stack, Text, Tooltip } from '@mantine/core';
import type { TrackStateCounts } from '@deadair/sdk';

import { severityColor, toneColor } from '../shared/status';
import type { TrackStateParam } from './catalog.page.params';

/**
 * The one deliberate half-step in the status set, which the status vocabulary has no tone for.
 *
 * `theme.ts` keeps `orange` for the record an operator can go and fix, a step below the amber the
 * station uses for its own decisions, and benched is exactly that: not a fault the station is
 * having, a copy somebody has to offer again. Named here with its reason rather than inline, so it
 * reads as the exception to `status.ts` that it is rather than a surface deciding it feels orange.
 */
const BENCHED = 'orange';

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
 *
 * `tone` is what the chip fills with once it is the chosen one. It is per-state rather than the
 * accent for all five because the accent means "good" on every other surface of this console, and a
 * chosen Benched chip drawn in it said the opposite of what it was filtering to — loudest thing on
 * the card, in the colour of a healthy station.
 */
const FILTERS: { state: TrackStateParam; label: string; help: string; tone: string; count: (counts: TrackStateCounts) => number }[] = [
    {
        state: 'cached',
        label: 'On this machine',
        help: 'The audio is here, so these can be committed to the running order now.',
        tone: toneColor.ok,
        count: counts => counts.cached,
    },
    {
        state: 'uncached',
        label: 'Not fetched',
        help: 'The station has not needed these yet. Ordinary for most of a library rather than a problem.',
        tone: toneColor.off,
        count: counts => counts.total - counts.cached,
    },
    {
        state: 'unmeasured',
        label: 'Unmeasured',
        help: 'No trustworthy measurement, so no cue points and no level decided before air. They still play.',
        tone: severityColor.warning,
        count: counts => counts.total - counts.measured,
    },
    {
        state: 'failing',
        label: 'Failing',
        help: 'A fetch has failed and is backing off. Four in a row writes the copy off.',
        tone: severityColor.failure,
        count: counts => counts.failing,
    },
    {
        state: 'benched',
        label: 'Benched',
        // Two causes wearing one word, and only one of them heals. A copy the provider refused is
        // never brought back by a sync, so a chip promising one is a chip an operator waits on.
        help: 'Every copy written off. A sync brings back the ones the provider still lists; one it refused stays off until you offer it again.',
        tone: BENCHED,
        count: counts => counts.benched,
    },
];

/**
 * A count as a share of the library, floored so that a non-zero one is never invisible.
 *
 * Three benched records out of 924 is 0.32%, which on a card this wide is three pixels, and one
 * unmeasured record is one pixel — indistinguishable from the state not existing, which is the one
 * thing a fault segment must never say. So anything non-zero gets 1.5% of the bar, which overstates
 * a handful of records deliberately: the bar's claim is that a state EXISTS, and the chip under it
 * is where the number is read.
 */
const slice = (count: number, total: number) => (total <= 0 || count <= 0 ? 0 : Math.max(1.5, (count / total) * 100));

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

    // The proportions the bar draws: what can air now, and what is here but has no measurement
    // behind it. Everything else is the track, because "not fetched" is not a state so much as the
    // absence of one.
    //
    // The segments have to be DISJOINT, which they were not: a record that is cached but unmeasured
    // is inside `cached`, so drawing `cached` and then `cached - measured` beside it counted it
    // twice and the row summed past 100%. A flex row that overflows its own `overflow: hidden` puts
    // the last segments past the right edge, so on a healthy library — 920 of 924 — the states worth
    // seeing were the ones clipped off and the whole card was one flat accent band. So `ready` is
    // what is cached AND measured, and it yields the width the other needs.
    const cachedUnmeasured = Math.max(0, counts.cached - counts.measured);
    const unmeasured = slice(cachedUnmeasured, counts.total);
    const ready = Math.min(slice(counts.cached - cachedUnmeasured, counts.total), Math.max(0, 100 - unmeasured));

    return (
        <Card withBorder padding="md">
            <Stack gap="xs">
                {/* The sentence first, because it is what an operator came for. Five chips each
                    holding a number made the reader do the division: the question is never "how
                    many are cached", it is "how much of my library can go out right now". */}
                <Group justify="space-between" align="baseline" gap="md" wrap="wrap">
                    <Text size="md">
                        <span className="da-num" style={{ fontWeight: 600 }}>
                            {counts.cached.toLocaleString()}
                        </span>{' '}
                        of <span className="da-num">{counts.total.toLocaleString()}</span> records are ready to air right now.
                    </Text>
                    <Text size="xs" c="dimmed">
                        The rest are fetched when the station wants them.
                    </Text>
                </Group>

                {/* Mantine's own bar rather than three `Box`es in a row, which is what let the
                    segments overflow silently. `size={6}` because this is an illustration of the
                    sentence above it and not the loudest thing on the card: at 8px, on a library
                    that is 99% ready, a full-width band of the accent outshouted the line it was
                    illustrating.

                    TWO segments, not three. Benched had one, and drawn beside the unmeasured one it
                    was not a distinction anybody could make: amber against red-orange is 1.36:1 on
                    carbon and 1.45:1 on Neon, and at 6px tall in a slice a few pixels wide two warm
                    hues that close are one slice. Any third segment lands next to the second, so
                    there is no ordering that fixes it — benched keeps its chip, where the colour has
                    a word and a number beside it. The two that are left are a green and an amber,
                    which nobody has to be told apart.

                    Each segment carries a tooltip because a colour with no key beside it is a
                    colour. The counts stay in the chips below, which is why the bar is out of the
                    accessibility tree rather than labelled twice. */}
                <Progress.Root size={6} aria-hidden>
                    <Tooltip label="Fetched and measured: ready to air.">
                        <Progress.Section value={ready} color={`${toneColor.ok}.4`} />
                    </Tooltip>
                    <Tooltip label="Here, but with no measurement behind it.">
                        <Progress.Section value={unmeasured} color={`${severityColor.warning}.4`} />
                    </Tooltip>
                </Progress.Root>

                {/* The chips keep their whole job as filters, and lose only the arithmetic. A chip
                    with nothing behind it stays drawn and disabled: zero benched records is a fact
                    worth seeing, and a list that changed shape as the numbers moved would be
                    unreadable. */}
                <Group gap="xs" align="center">
                    {FILTERS.map(filter => {
                        const count = filter.count(counts);
                        const chosen = value === filter.state;
                        const empty = count === 0 && !chosen;
                        return (
                            <Tooltip key={filter.state} label={filter.help} multiline w={260}>
                                <Chip
                                    size="sm"
                                    color={filter.tone}
                                    checked={chosen}
                                    disabled={empty}
                                    // A zero chip, drawn so it is still a chip.
                                    //
                                    // Mantine fills a disabled control with `--mantine-color-dark-6`
                                    // and that is EXACTLY what a Card is filled with, so on carbon
                                    // and on Neon the chip and the card behind it were the same
                                    // colour to four decimal places — "0 Failing" had no shape at
                                    // all. On Studio White the surface survived and the text did
                                    // not: Mantine's disabled ink there is `gray-5` on `gray-2`,
                                    // which measures 1.28:1 and cannot be read at any size.
                                    //
                                    // So all three of them are named. `--da-raised` lifts the pill
                                    // off the card, `--da-border-strong` is what actually draws its
                                    // edge, and the console's own dimmed ink puts the number back
                                    // above 3.8:1 on every theme. Still quieter than a live chip,
                                    // which is right — there is nothing to filter to — but legible
                                    // as a zero, which is the whole reason it is drawn.
                                    styles={
                                        empty
                                            ? {
                                                  label: {
                                                      background: 'var(--da-raised)',
                                                      border: '1px solid var(--da-border-strong)',
                                                      color: 'var(--mantine-color-dimmed)',
                                                  },
                                              }
                                            : undefined
                                    }
                                    onChange={checked => {
                                        onChange(checked ? filter.state : '');
                                    }}
                                >
                                    <span className="da-num" style={{ fontWeight: 600 }}>
                                        {count.toLocaleString()}
                                    </span>{' '}
                                    {filter.label}
                                </Chip>
                            </Tooltip>
                        );
                    })}
                </Group>
            </Stack>
        </Card>
    );
}
