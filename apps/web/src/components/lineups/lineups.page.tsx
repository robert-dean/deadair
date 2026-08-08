import { useState } from 'react';
import { Alert, Anchor, Button, Card, Group, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { lineupsListOptions, useStationAir } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ImportLineupModal } from './import.lineup.modal';
import { LineupCard } from './lineup.card';

/**
 * Every lineup the station holds.
 *
 * A lineup is the station's PLAN — what it means to play, in order, and what to do when that runs
 * out. The transport at the foot of the console is what has become of the head of one: items
 * already handed to the player. This page is the plan; the bar is the consequence.
 */
export function LineupsPage() {
    const lineups = useQuery(lineupsListOptions);
    // Read here rather than in the card, so one poll serves the whole grid instead of one per card.
    const air = useStationAir();
    const [importing, setImporting] = useState(false);

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="nowrap">
                <Stack gap={4}>
                    <Title order={1}>Lineups</Title>
                    <Text c="dimmed" size="sm">
                        {lineups.data
                            ? `${lineups.data.lineups.length} ${lineups.data.lineups.length === 1 ? 'lineup' : 'lineups'}`
                            : 'What the station means to play, and in what order.'}
                    </Text>
                </Stack>
                <Button
                    onClick={() => {
                        setImporting(true);
                    }}
                >
                    Import a lineup
                </Button>
            </Group>

            <ImportLineupModal
                opened={importing}
                onClose={() => {
                    setImporting(false);
                }}
            />

            {lineups.error ? (
                <Alert color="red" title="Lineups could not be loaded">
                    {apiErrorMessage(lineups.error, 'The station’s programming is unavailable.')}
                </Alert>
            ) : undefined}

            {lineups.isPending ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {[0, 1, 2].map(index => (
                        <Skeleton key={index} height={220} radius="sm" />
                    ))}
                </SimpleGrid>
            ) : undefined}

            {lineups.data?.lineups.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Stack gap="xs">
                        <Text fw={600}>The station has no lineups</Text>
                        <Text size="sm" c="dimmed" maw={520}>
                            Import one from a provider playlist to give the station something to play.{' '}
                            <Anchor renderRoot={props => <Link to="/playlists" {...props} />}>Browse playlists</Anchor>.
                        </Text>
                    </Stack>
                </Card>
            ) : undefined}

            {lineups.data && lineups.data.lineups.length > 0 ? (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                    {lineups.data.lineups.map(lineup => (
                        <LineupCard key={lineup.id} lineup={lineup} air={air.data} />
                    ))}
                </SimpleGrid>
            ) : undefined}
        </Stack>
    );
}
