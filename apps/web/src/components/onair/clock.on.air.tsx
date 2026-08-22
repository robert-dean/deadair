import { Button, Collapse, Group, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { useState } from 'react';
import type { ClockBand } from '@deadair/sdk';

import { useClockBands } from '../../api/clock.queries';
import { ClockPanel, whenOf } from '../schedule/clock.panel';

/**
 * What the station will SAY during this broadcast, on the page the broadcast is started from.
 *
 * The two ways to run this station are a brief typed here and a schedule of dayparts, and neither of
 * them has anything to do with the format clock: `ClockBandRepository.active()` is keyed on the
 * station and `BreakPlanner.plant` runs from the director's commit pass whichever way the running
 * order was built. So one clock already covers both, and the gap this closes is entirely one of
 * saying so — an operator setting up a show here was shown what it plays, who hosts it and which
 * period it draws from, and nothing at all about whether it would read the news.
 *
 * ## The real table, behind a fold
 *
 * Not a read-only summary with a link to the schedule page. Wanting news is the moment an operator
 * has while they are looking at this, and sending them somewhere else to write one line is how the
 * clock stays empty. `ClockPanel` takes no props and owns its own queries and its own editor sheet,
 * so this is that panel with a sentence in front of it rather than a second way to edit a band.
 *
 * Collapsed by default in both states, because editing the clock is not part of starting a
 * broadcast: what is in view is the sentence saying what the clock will do, which is also the
 * affordance for changing it. The same fold `BriefTheStation` uses, one card up.
 *
 * ## The summary is what is IN FORCE
 *
 * Switched-off bands are left out of it and drawn in the panel below, which is the same split
 * `ClockBandRepository` already makes between what the planner is handed and what the operator can
 * see. A clock whose rules are all switched off says so rather than reading as an empty one, since
 * those are two different things to do something about.
 */
export function ClockOnAir() {
    const clock = useClockBands();
    const [opened, setOpened] = useState(false);

    const bands = clock.data?.bands ?? [];
    const inForce = bands.filter(band => band.enabled);
    const producible = new Set(clock.data?.producibleKinds ?? []);

    return (
        <Stack gap="xs" align="stretch">
            <Group gap="sm" justify="space-between" wrap="nowrap">
                {/* Nothing is drawn until the clock has answered: an empty list is what both a
                    station with no bands and an unanswered query look like, and saying the station
                    will be quiet before knowing is worse than saying nothing for a moment. */}
                <Text size="sm" c="dimmed">
                    {clock.data === undefined ? ' ' : summaryOf(inForce, bands.length, producible)}
                </Text>
                <Button
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    px={0}
                    rightSection={opened ? <IconChevronUp size={14} stroke={1.8} /> : <IconChevronDown size={14} stroke={1.8} />}
                    onClick={() => setOpened(open => !open)}
                >
                    {opened ? 'Done with the clock' : 'Change what it says'}
                </Button>
            </Group>
            <Collapse expanded={opened}>
                <ClockPanel />
            </Collapse>
        </Stack>
    );
}

/**
 * The whole clock as one line.
 *
 * A band nothing can produce is named rather than left to the panel, because the panel is behind a
 * fold and this is the state an operator most needs to be told about unasked: the rule is written,
 * it looks right, and the station passes over its slot every time it comes round.
 */
function summaryOf(inForce: readonly ClockBand[], total: number, producible: ReadonlySet<string>): string {
    if (total === 0) return 'Nothing on the clock: the station keeps its ordinary spacing and says nothing else.';
    // Rules exist and every one of them is switched off, which is a different thing from having
    // none and has a different answer: turn one back on.
    if (inForce.length === 0) return 'Nothing on the clock is in force: every band is switched off.';

    return `On the clock: ${inForce.map(band => sentenceFor(band, producible)).join(' · ')}`;
}

/**
 * One band as an operator would say it.
 *
 * The subject leads, exactly as `BreakPlanner.fillBand` composes the label it plants ("Technology
 * news"), so the line here and the row in the running order name one thing one way.
 */
function sentenceFor(band: ClockBand, producible: ReadonlySet<string>): string {
    const what = band.topicLabel === undefined ? band.kind : `${band.topicLabel} ${band.kind}`;
    const when = band.at === 'interval' ? whenOf(band) : `at ${whenOf(band)}`;
    const warning = producible.has(band.kind) ? '' : ' (nothing can produce this)';

    return `${what} ${when}${warning}`;
}
