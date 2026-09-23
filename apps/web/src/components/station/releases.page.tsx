import { useState } from 'react';
import { Anchor, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { StationRelease, StationReleases } from '@deadair/sdk';
import { DateTime } from 'luxon';

import { useStationReleases } from '../../api/station.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { MarkdownView } from '../shared/markdown.view';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * How many releases are drawn before the rest are asked for.
 *
 * Five, because what somebody opens this for is the release they just installed and the few before
 * it. The changelog holds every release there has been, and drawing all of them is a page of notes
 * about problems long fixed between the operator and the button they came for.
 */
export const RELEASES_SHOWN = 5;

/**
 * What changed in each release this station contains, newest first, and anything newer that is out.
 *
 * The releases it contains are read from the changelog the build carries, so they answer with no
 * internet: that part is the station saying what it is, not a page about the project. The newer ones
 * are what the station last heard from GitHub, drawn first and set apart, because they are the reason
 * somebody following the header's notice came here.
 */
export function ReleasesPage() {
    const releases = useStationReleases();
    const [showAll, setShowAll] = useState(false);

    const header = (
        <PageHeader
            title="What’s new"
            description={
                <Text size="sm" c="dimmed">
                    What changed in each release this station contains, newest first, from the changelog it was built with.
                </Text>
            }
        />
    );

    if (releases.isPending) {
        return (
            <Stack gap="lg">
                {header}
                <PageSkeleton variant="card" />
            </Stack>
        );
    }

    if (releases.error) {
        return (
            <Stack gap="lg">
                {header}
                <ErrorAlert title="Could not load the release notes" error={releases.error} fallback="The release notes could not be fetched." />
            </Stack>
        );
    }

    const { current, notes, available } = releases.data;
    const shown = showAll ? notes : notes.slice(0, RELEASES_SHOWN);
    const hidden = notes.length - shown.length;

    return (
        <Stack gap="lg">
            {header}

            <CheckLine releases={releases.data} />

            {available.length > 0 && (
                <Stack gap="md">
                    <Eyebrow>
                        {available.length === 1
                            ? 'Out, and not on this station yet'
                            : `${available.length} releases out, and not on this station yet`}
                    </Eyebrow>
                    <Text size="sm">
                        Upgrading is pulling the new image, the same way the station was installed. It keeps everything it holds across the upgrade.
                    </Text>
                    {available.map(release => (
                        <ReleaseCard key={release.version} release={release} state="available" />
                    ))}
                    <Eyebrow>On this station</Eyebrow>
                </Stack>
            )}

            {notes.length === 0 ? (
                <EmptyState title="No release notes">
                    This build carries no changelog, so there is nothing to say about what changed in it.
                </EmptyState>
            ) : (
                <Stack gap="md">
                    {shown.map(release => (
                        <ReleaseCard key={release.version} release={release} state={release.version === current ? 'running' : undefined} />
                    ))}
                    {hidden > 0 && (
                        <Group>
                            <Button variant="subtle" onClick={() => setShowAll(true)}>
                                {hidden === 1 ? 'Show 1 older release' : `Show ${hidden} older releases`}
                            </Button>
                        </Group>
                    )}
                </Stack>
            )}
        </Stack>
    );
}

/**
 * Whether the station is looking for newer releases, and when it last heard.
 *
 * Said on the page rather than left to the absence of a newer release, because "nothing newer" and
 * "not looking" read identically otherwise, and only one of them is something the operator chose.
 */
function CheckLine({ releases }: { releases: StationReleases }) {
    if (!releases.checks) {
        return (
            <Text size="sm" c="dimmed">
                The station is not checking for newer releases. Turn it on under{' '}
                <Anchor size="sm" renderRoot={(props: object) => <Link to="/settings/station" {...props} />}>
                    Settings, Station
                </Anchor>
                .
            </Text>
        );
    }

    return (
        <Text size="sm" c="dimmed">
            {releases.checkedAt === undefined
                ? 'The station checks GitHub for newer releases every few hours, and has not heard back yet.'
                : `The station checks GitHub for newer releases every few hours. It last heard back ${releases.checkedAt.toLocaleString(DateTime.DATETIME_MED)}.`}
        </Text>
    );
}

/**
 * One release and its notes.
 *
 * The SDK reads the day as a local midnight, so Luxon formats it as the same day in every zone.
 */
function ReleaseCard({ release, state }: { release: StationRelease; state?: 'running' | 'available' }) {
    return (
        <Card padding="md">
            <Stack gap="sm">
                <Group gap="sm" wrap="wrap">
                    <Title order={3} className="da-num">
                        {release.version}
                    </Title>
                    {release.date !== undefined && (
                        <Text size="sm" c="dimmed">
                            {release.date.toLocaleString(DateTime.DATE_MED)}
                        </Text>
                    )}
                    {state === 'running' && (
                        <Badge variant="light" color="teal">
                            This station
                        </Badge>
                    )}
                    {state === 'available' && (
                        <Badge variant="light" color="blue">
                            Not installed
                        </Badge>
                    )}
                    {release.url !== undefined && (
                        <Anchor size="sm" href={release.url} target="_blank" rel="noreferrer">
                            Release page
                        </Anchor>
                    )}
                </Group>
                {release.notes === '' ? (
                    <Text size="sm" c="dimmed">
                        Nothing was recorded for this release.
                    </Text>
                ) : (
                    <MarkdownView text={release.notes} />
                )}
            </Stack>
        </Card>
    );
}
