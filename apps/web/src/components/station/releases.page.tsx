import { useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { StationRelease } from '@deadair/sdk';
import { DateTime } from 'luxon';

import { useStationReleases } from '../../api/station.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
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
 * What changed in each release this station contains, newest first.
 *
 * Read from the changelog the build carries, so it answers with no internet: it is the station saying
 * what it is, not a page about the project.
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

    const { current, notes } = releases.data;
    const shown = showAll ? notes : notes.slice(0, RELEASES_SHOWN);
    const hidden = notes.length - shown.length;

    return (
        <Stack gap="lg">
            {header}

            {notes.length === 0 ? (
                <EmptyState title="No release notes">
                    This build carries no changelog, so there is nothing to say about what changed in it.
                </EmptyState>
            ) : (
                <Stack gap="md">
                    {shown.map(release => (
                        <ReleaseCard key={release.version} release={release} running={release.version === current} />
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
 * One release and its notes.
 *
 * The day arrives as an ISO date, which is what it is: a release goes out on a day, not at a moment.
 */
function ReleaseCard({ release, running }: { release: StationRelease; running: boolean }) {
    return (
        <Card padding="md">
            <Stack gap="sm">
                <Group gap="sm" wrap="wrap">
                    <Title order={3} className="da-num">
                        {release.version}
                    </Title>
                    {release.date !== undefined && (
                        <Text size="sm" c="dimmed">
                            {formatReleaseDay(release.date)}
                        </Text>
                    )}
                    {running && (
                        <Badge variant="light" color="teal">
                            This station
                        </Badge>
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

/**
 * An ISO date as the operator's locale writes one. Read by Luxon in the browser's own zone rather than
 * handed to `Date`, which reads `2026-09-23` as a UTC midnight and shows the day before anywhere west of
 * Greenwich. A value that is not a date is drawn as it came.
 */
export function formatReleaseDay(day: string): string {
    const parsed = DateTime.fromISO(day);
    return parsed.isValid ? parsed.toLocaleString(DateTime.DATE_MED) : day;
}
