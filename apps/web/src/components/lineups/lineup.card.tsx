import { Anchor, Badge, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { LineupSummary, StationAir } from '@deadair/sdk';

export interface LineupCardProps {
    lineup: LineupSummary;
    /** What the station is airing, when the console has read it. */
    air?: StationAir;
}

/** What each mode means, in the one sentence an operator needs to pick between them. */
const MODE_LABELS: Record<LineupSummary['mode'], string> = {
    rotation: 'Rotation, spaced by the station’s own rules',
    setlist: 'A setlist, played in the order it holds',
    feature: 'A feature: one body of work, start to finish',
};

/** What happens when a lineup runs out. */
const ON_END_LABELS: Record<LineupSummary['onEnd'], string> = {
    extend: 'Extends itself before it runs out',
    repeat: 'Starts again from the top',
    resume: 'Hands the station back to whatever it interrupted',
    rotation: 'Falls back to the station’s rotation',
    stop: 'Stops the station',
};

/**
 * Whether this lineup is the one the station is programmed with.
 *
 * Never, now: nothing airs FROM a stored lineup. What is on air is built from a playlist when the
 * station goes on, so a stored one is prepared material and the station has no opinion about it.
 * Kept as one function returning nothing rather than threaded out of every caller, because the
 * whole page goes when the on-air console lands.
 */
function airState(_lineup: LineupSummary, _air: StationAir | undefined): 'on-air' | 'stood-down' | undefined {
    return undefined;
}

/**
 * One lineup as the list shows it.
 *
 * Deliberately just a description and a way in. Airing a lineup and deleting one are decisions
 * every listener hears, and they belong on the page that shows the order they would act on, not on
 * a card in a grid where the neighbouring one is a mis-click away.
 */
export function LineupCard({ lineup, air }: LineupCardProps) {
    const state = airState(lineup, air);

    return (
        <Card withBorder padding="lg" radius="sm">
            <Stack gap="sm" h="100%">
                <Stack gap={6}>
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <Text fw={600} size="lg" lh={1.2}>
                            {lineup.name}
                        </Text>
                        {state === 'on-air' ? (
                            <Badge variant="filled" color="red">
                                on air
                            </Badge>
                        ) : undefined}
                        {state === 'stood-down' ? (
                            <Badge variant="light" color="gray">
                                stood down
                            </Badge>
                        ) : undefined}
                    </Group>
                    <Group gap="xs">
                        <Badge size="sm" variant="light" tt="none">
                            {lineup.mode}
                        </Badge>
                        <Badge size="sm" variant="light" color="gray" tt="none">
                            ends: {lineup.onEnd}
                        </Badge>
                    </Group>
                </Stack>

                <Stack gap={2}>
                    <Text size="sm" c="dimmed">
                        {MODE_LABELS[lineup.mode]}
                    </Text>
                    <Text size="sm" c="dimmed">
                        {ON_END_LABELS[lineup.onEnd]}
                    </Text>
                </Stack>

                <Text size="xs" c="dimmed">
                    {lineup.itemCount === 1 ? '1 track' : `${lineup.itemCount} tracks`}
                    {/* Where it came from, when something other than the director built it. An
                        operator looking for the lineup they imported an hour ago is looking for
                        the plugin's name, not for `import`. */}
                    {lineup.sourcePluginId ? ` • imported from ${lineup.sourcePluginId}` : ''}
                </Text>

                <Divider mt="auto" />

                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={props => <Link to="/lineups/$lineupId" params={{ lineupId: lineup.id }} {...props} />} size="sm">
                    View the order
                </Anchor>
            </Stack>
        </Card>
    );
}
