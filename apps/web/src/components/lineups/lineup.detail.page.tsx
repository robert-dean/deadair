import { Alert, Anchor, Badge, Card, Group, Skeleton, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { lineupOptions, useRemoveLineupItem, useStationAir } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { LineupActions } from './lineup.actions';
import { STALE_LINEUP_MESSAGE, useLineupEditGuard } from './lineup.edit.guard';
import { LineupOrderTable } from './lineup.order.table';

export interface LineupDetailPageProps {
    lineupId: string;
}

/**
 * One lineup and its whole order.
 *
 * The cursor is the point of the page. Everything above it has been handed to the player and is
 * beyond editing; everything below it is still the operator's to change. A console that drew a
 * flat list would be offering controls the API answers 422 to, and hiding the one fact an operator
 * needs before they touch anything: how far into the plan the broadcast already is.
 */
export function LineupDetailPage({ lineupId }: LineupDetailPageProps) {
    const lineup = useQuery(lineupOptions(lineupId));
    const air = useStationAir();
    const guard = useLineupEditGuard(lineupId);
    const removeItem = useRemoveLineupItem();

    // Bound once: every edit below sends the revision of the order that was drawn, and reading it
    // back off the query at call time would send whatever the cache had drifted to instead.
    const loaded = lineup.data;
    const onAir = air.data?.lineupId === lineupId;
    // Both halves come from the lineup's own cursor rather than one from here and one from the air
    // poll. The two readings are taken on different clocks, and mixing them puts a sentence on the
    // page whose numbers do not add up to the track count printed beside them.
    const committed = loaded?.cursor ?? 0;
    const toGo = loaded === undefined ? 0 : loaded.items.length - loaded.cursor;

    return (
        <Stack gap="lg">
            <Stack gap={4}>
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={props => <Link to="/lineups" {...props} />} size="sm">
                    Back to lineups
                </Anchor>
                <Group justify="space-between" align="flex-end" wrap="nowrap">
                    <Stack gap={6}>
                        <Group gap="sm" wrap="nowrap">
                            <Title order={1}>{loaded?.name ?? lineupId}</Title>
                            {onAir ? (
                                <Badge variant={air.data?.active ? 'filled' : 'light'} color={air.data?.active ? 'red' : 'gray'}>
                                    {air.data?.active ? 'on air' : 'stood down'}
                                </Badge>
                            ) : undefined}
                        </Group>
                        {loaded ? (
                            <Group gap="xs">
                                <Badge size="sm" variant="light" tt="none">
                                    {loaded.mode}
                                </Badge>
                                <Badge size="sm" variant="light" color="gray" tt="none">
                                    ends: {loaded.onEnd}
                                </Badge>
                                <Text size="sm" c="dimmed">
                                    {loaded.items.length === 1 ? '1 track' : `${loaded.items.length} tracks`}
                                    {/* Only while this is the lineup on air. A cursor on a lineup
                                        nobody is playing reads as zero, which is honest, and
                                        saying "0 played" about it would imply it is queued to.

                                        "Played" would also be wrong by the commit lead: the last few
                                        locked lines are still waiting their turn. */}
                                    {onAir ? ` • ${committed} locked • ${toGo} to go` : ''}
                                </Text>
                            </Group>
                        ) : undefined}
                    </Stack>
                    {loaded ? <LineupActions lineup={loaded} onAir={onAir} onEditError={guard.onError} /> : undefined}
                </Group>
            </Stack>

            {/* The refusal is the console working, not failing: the order below has already been
                re-read, so the operator can make the same decision against what is actually true. */}
            {guard.conflict ? (
                <Alert color="yellow" title="That edit was refused" withCloseButton closeButtonLabel="Dismiss" onClose={guard.dismissConflict}>
                    {STALE_LINEUP_MESSAGE}
                </Alert>
            ) : undefined}

            {lineup.error ? (
                <Alert color="red" title="This lineup could not be loaded">
                    {apiErrorMessage(lineup.error, 'The station no longer holds this lineup.')}
                </Alert>
            ) : undefined}

            {lineup.isPending ? <Skeleton height={280} radius="sm" /> : undefined}

            {loaded?.items.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Text size="sm" c="dimmed">
                        This lineup holds nothing. Putting it on air would air silence.
                    </Text>
                </Card>
            ) : undefined}

            {loaded && loaded.items.length > 0 ? (
                <LineupOrderTable
                    items={loaded.items}
                    cursor={loaded.cursor}
                    removingItemId={removeItem.isPending ? removeItem.variables?.itemId : undefined}
                    onRemove={item => {
                        // The revision of the order that was drawn, so an edit made against a list
                        // that has since changed is refused rather than applied to whatever is in
                        // that position now.
                        removeItem.mutate({ lineupId, itemId: item.id, revision: loaded.revision }, { onError: guard.onError });
                    }}
                />
            ) : undefined}
        </Stack>
    );
}
