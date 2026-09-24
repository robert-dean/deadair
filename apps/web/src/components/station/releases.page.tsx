import { useState } from 'react';
import { Anchor, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { StationRelease, StationReleases } from '@deadair/sdk';
import { DateTime } from 'luxon';
import { Trans, useTranslation } from 'react-i18next';

import { useCheckStationReleases, useStationReleases } from '../../api/station.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { MarkdownView } from '../shared/markdown.view';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { formatLocale } from '../../i18n/format.locale';
import { i18n } from '../../i18n/i18n.setup';

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
    const { t } = useTranslation('station');
    const releases = useStationReleases();
    const [showAll, setShowAll] = useState(false);

    const header = (
        <PageHeader
            title={t('releases.title')}
            description={
                <Text size="sm" c="dimmed">
                    {t('releases.description')}
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
                <ErrorAlert title={t('releases.loadFailedTitle')} error={releases.error} fallback={t('releases.loadFailedFallback')} />
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
                    <Eyebrow>{t('releases.available', { count: available.length })}</Eyebrow>
                    <Text size="sm">{t('releases.upgrading')}</Text>
                    {available.map(release => (
                        <ReleaseCard key={release.version} release={release} state="available" />
                    ))}
                    <Eyebrow>{t('releases.onThisStation')}</Eyebrow>
                </Stack>
            )}

            {notes.length === 0 ? (
                <EmptyState title={t('releases.noneTitle')}>{t('releases.none')}</EmptyState>
            ) : (
                <Stack gap="md">
                    {shown.map(release => (
                        <ReleaseCard key={release.version} release={release} state={release.version === current ? 'running' : undefined} />
                    ))}
                    {hidden > 0 && (
                        <Group>
                            <Button variant="subtle" onClick={() => setShowAll(true)}>
                                {t('releases.showOlder', { count: hidden })}
                            </Button>
                        </Group>
                    )}
                </Stack>
            )}
        </Stack>
    );
}

/**
 * Whether the station is looking for newer releases, when it last heard, and the button that asks now.
 *
 * Said on the page rather than left to the absence of a newer release, because "nothing newer" and
 * "not looking" read identically otherwise, and only one of them is something the operator chose. No
 * button while the check is off: it would send nothing, and pressing it would look like an answer.
 *
 * The button is drawn for everybody, as the plugin page's Rescan is, and a listener pressing it gets
 * the station's own refusal: the console holds no copy of who may do what.
 */
function CheckLine({ releases }: { releases: StationReleases }) {
    const { t } = useTranslation('station');
    const check = useCheckStationReleases();

    if (!releases.checks) {
        return (
            <Text size="sm" c="dimmed">
                <Trans
                    t={t}
                    i18nKey="releases.notChecking"
                    components={{ settings: <Anchor size="sm" renderRoot={(props: object) => <Link to="/settings/station" {...props} />} /> }}
                />
            </Text>
        );
    }

    return (
        <Stack gap="xs">
            <Group gap="sm" wrap="wrap">
                <Text size="sm" c="dimmed">
                    {releases.checkedAt === undefined
                        ? t('releases.checksNotHeard')
                        : t('releases.checksHeard', { when: releases.checkedAt.toLocaleString(DateTime.DATETIME_MED, { locale: formatLocale() }) })}
                </Text>
                <Button variant="light" size="compact-sm" loading={check.isPending} onClick={() => check.mutate()}>
                    {t('releases.checkNow')}
                </Button>
            </Group>
            {check.data !== undefined && (
                <Text size="sm" role="status">
                    {checkOutcome(check.data, DateTime.now())}
                </Text>
            )}
            {check.error && (
                <ErrorAlert
                    title={t('releases.checkFailedTitle')}
                    error={check.error}
                    fallback={t('releases.checkFailedFallback')}
                    onDismiss={check.reset}
                />
            )}
        </Stack>
    );
}

/**
 * How long ago an answer can be and still count as the one a Check now just got.
 *
 * Two minutes: the station answers a click inside a minute of its last question with that question's
 * answer, and a little more covers a slow request.
 */
const FRESH_ANSWER_MS = 2 * 60_000;

/**
 * What a Check now found, in a sentence.
 *
 * The page redraws from the same answer, so a newer release appears in the list either way. This says
 * what the redraw cannot: that GitHub did not answer, which otherwise looks exactly like nothing having
 * happened, or that it did and there is nothing newer.
 */
export function checkOutcome(releases: StationReleases, now: DateTime): string {
    const answered = releases.checkedAt !== undefined && now.toMillis() - releases.checkedAt.toMillis() < FRESH_ANSWER_MS;
    if (!answered) return i18n.t('station:releases.outcome.noAnswer');

    const newest = releases.available[0];
    if (newest === undefined) {
        return releases.current === undefined
            ? i18n.t('station:releases.outcome.nothingNewer')
            : i18n.t('station:releases.outcome.nothingNewerThan', { version: releases.current });
    }
    return releases.available.length === 1
        ? i18n.t('station:releases.outcome.oneNewer', { version: newest.version })
        : i18n.t('station:releases.outcome.manyNewer', { total: releases.available.length, version: newest.version });
}

/**
 * One release and its notes.
 *
 * The SDK reads the day as a local midnight, so Luxon formats it as the same day in every zone.
 */
function ReleaseCard({ release, state }: { release: StationRelease; state?: 'running' | 'available' }) {
    const { t } = useTranslation('station');
    return (
        <Card padding="md">
            <Stack gap="sm">
                <Group gap="sm" wrap="wrap">
                    <Title order={3} className="da-num">
                        {release.version}
                    </Title>
                    {release.date !== undefined && (
                        <Text size="sm" c="dimmed">
                            {release.date.toLocaleString(DateTime.DATE_MED, { locale: formatLocale() })}
                        </Text>
                    )}
                    {state === 'running' && (
                        <Badge variant="light" color="teal">
                            {t('releases.badge.running')}
                        </Badge>
                    )}
                    {state === 'available' && (
                        <Badge variant="light" color="blue">
                            {t('releases.badge.available')}
                        </Badge>
                    )}
                    {release.url !== undefined && (
                        <Anchor size="sm" href={release.url} target="_blank" rel="noreferrer">
                            {t('releases.releasePage')}
                        </Anchor>
                    )}
                </Group>
                {release.notes === '' ? (
                    <Text size="sm" c="dimmed">
                        {t('releases.noNotes')}
                    </Text>
                ) : (
                    <MarkdownView text={release.notes} />
                )}
            </Stack>
        </Card>
    );
}
