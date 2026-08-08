import { Alert, Anchor, Badge, Card, Group, Skeleton, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { lineupOptions, useStationAir } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
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

    const onAir = air.data?.lineupId === lineupId;
    const committed = lineup.data?.items.filter(item => item.committed).length ?? 0;

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
                            <Title order={1}>{lineup.data?.name ?? lineupId}</Title>
                            {onAir ? (
                                <Badge variant={air.data?.active ? 'filled' : 'light'} color={air.data?.active ? 'red' : 'gray'}>
                                    {air.data?.active ? 'on air' : 'stood down'}
                                </Badge>
                            ) : undefined}
                        </Group>
                        {lineup.data ? (
                            <Group gap="xs">
                                <Badge size="sm" variant="light" tt="none">
                                    {lineup.data.mode}
                                </Badge>
                                <Badge size="sm" variant="light" color="gray" tt="none">
                                    ends: {lineup.data.onEnd}
                                </Badge>
                                <Text size="sm" c="dimmed">
                                    {lineup.data.items.length === 1 ? '1 track' : `${lineup.data.items.length} tracks`}
                                    {/* Only while this is the lineup on air. A cursor on a lineup
                                        nobody is playing reads as zero, which is honest, and
                                        saying "0 aired" about it would imply it is queued to. */}
                                    {onAir ? ` • ${committed} aired • ${air.data?.remaining ?? 0} to go` : ''}
                                </Text>
                            </Group>
                        ) : undefined}
                    </Stack>
                </Group>
            </Stack>

            {lineup.error ? (
                <Alert color="red" title="This lineup could not be loaded">
                    {apiErrorMessage(lineup.error, 'The station no longer holds this lineup.')}
                </Alert>
            ) : undefined}

            {lineup.isPending ? <Skeleton height={280} radius="sm" /> : undefined}

            {lineup.data?.items.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Text size="sm" c="dimmed">
                        This lineup holds nothing. Putting it on air would air silence.
                    </Text>
                </Card>
            ) : undefined}

            {lineup.data && lineup.data.items.length > 0 ? <LineupOrderTable items={lineup.data.items} cursor={lineup.data.cursor} /> : undefined}
        </Stack>
    );
}
