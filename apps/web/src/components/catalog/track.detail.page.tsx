import { Anchor, Badge, Card, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { TrackBinding, TrackDetail } from '@deadair/sdk';

import { catalogTrackEnrichmentOptions, catalogTrackOptions, useRateTrack } from '../../api/catalog.queries';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { formatBytes } from '../shared/format.bytes';
import { formatDuration } from '../shared/format.duration';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';
import type { StatusTone } from '../shared/status';
import { Artwork } from '../shared/artwork';
import { EnrichmentPanel } from './enrichment.panel';
import { RatingControl } from './rating.control';
import { TrackClearMenu } from './track.clear.menu';

/** A moment, to the minute. These are all "when did this last happen" rather than dates on a calendar. */
const MOMENT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const moment = (iso: string | undefined): string => {
    if (iso === undefined || iso === '') return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : MOMENT.format(date);
};

/**
 * What one copy of a record is doing, as a tone and a word.
 *
 * The order is the order an operator has to read them in, and it is why this is a function rather
 * than a lookup: a benched copy is benched whatever its cache row says, and a copy backing off after
 * failures is a different problem from one nothing has ever tried.
 */
function bindingStatus(binding: TrackBinding): { tone: StatusTone; label: string; detail: string } {
    // `off` rather than `fault` for the two below, and the distinction is the one `status.ts` exists
    // for: the station stood this copy down on purpose and is not currently trying, which is not the
    // same as something going wrong right now.
    if (binding.missingAt !== undefined) {
        return {
            tone: 'off',
            label: 'Benched',
            detail: `The station gave up on this copy ${moment(binding.missingAt)}. The next sync that still sees it puts it back.`,
        };
    }
    if (!binding.playable) {
        return { tone: 'off', label: 'Not offered', detail: 'The provider knows this record but will not serve this copy here.' };
    }
    if (binding.lastError !== undefined && binding.byteSize === undefined) {
        return {
            tone: 'fault',
            label: `Failing (${binding.attempts})`,
            detail: `${binding.lastError}. Next attempt ${moment(binding.nextAttemptAt)}.`,
        };
    }
    // `byteSize` rather than `fetchedAt`, and the difference is a record whose bytes have been
    // evicted: the sweep clears the file columns and keeps the row, so a copy that was fetched once
    // and dropped since is not on this machine however recently it arrived.
    if (binding.byteSize !== undefined) {
        return { tone: 'ok', label: 'On this machine', detail: `Fetched ${moment(binding.fetchedAt)}.` };
    }
    if (binding.lastServedAt !== undefined) {
        return {
            tone: 'standby',
            label: 'Dropped',
            detail: `Played ${moment(binding.lastServedAt)} and since dropped to stay under the cache limit. The station fetches it again when it comes round.`,
        };
    }
    // Waiting rather than broken: the station fetches a record a few boundaries before its slot, so
    // a copy nothing has needed yet is the ordinary state of most of the library.
    return { tone: 'standby', label: 'Not fetched', detail: 'Nothing has needed this copy yet. The station fetches it before its first slot.' };
}

/**
 * Everything one record has accumulated, in one place.
 *
 * The page exists because the answer to "why will this record not air" was a `psql` session: seven
 * axes of state are rows and the console could read two of them. The three answers it now
 * distinguishes are every copy benched, the bytes unfetchable and backed off, and nothing wrong at
 * all — the last being a record that is simply inside its repeat window, which is not a fault and
 * must not be drawn as one.
 *
 * Per BINDING throughout, never per track. Two copies of one record inside one provider are two
 * files with different loudness and different cue points, and the one that airs is the one that was
 * resolved.
 */
export function TrackDetailPage({ trackId }: { trackId: string }) {
    const track = useQuery(catalogTrackOptions(trackId));
    const enrichment = useQuery(catalogTrackEnrichmentOptions(trackId));
    const rate = useRateTrack();

    if (track.isPending) return <PageSkeleton variant="table" />;

    if (track.error || !track.data) {
        return <ErrorAlert title="This record could not be loaded" error={track.error} fallback="No track with that id is in the catalog." />;
    }

    const detail = track.data;

    return (
        <Stack gap="lg">
            <Group align="flex-start" gap="md" wrap="nowrap">
                <Artwork src={detail.albumImageUrl} alt={detail.title} size={160} />
                <Stack gap="xxs">
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={props => <Link to="/catalog/tracks" {...props} />} size="sm">
                        Back to tracks
                    </Anchor>
                    <PageHeader
                        title={detail.title}
                        // On the header rather than beside each card: a clear is one gesture with
                        // four objects, and putting a button on every panel would read as four
                        // unrelated features.
                        actions={<TrackClearMenu trackId={trackId} />}
                        description={
                            <Text c="dimmed" size="sm">
                                {detail.artists}
                                {detail.albumName === undefined ? '' : ` • ${detail.albumName}`}
                                {detail.year === undefined ? '' : ` • ${detail.year}`}
                                {detail.durationMs === undefined ? '' : ` • ${formatDuration(detail.durationMs)}`}
                            </Text>
                        }
                    >
                        <Group gap="xs" pt="xxs">
                            <RatingControl
                                size="xs"
                                rating={detail.rating}
                                label={detail.title}
                                busy={rate.isPending}
                                onChange={rating => {
                                    rate.mutate({ id: trackId, rating });
                                }}
                            />
                        </Group>
                    </PageHeader>
                </Stack>
            </Group>

            <BindingsCard detail={detail} />
            <MeasurementCard detail={detail} />
            <AiringsCard detail={detail} />

            <EnrichmentPanel
                merged={enrichment.data?.merged}
                sources={enrichment.data?.sources}
                claims={enrichment.data?.claims}
                isPending={enrichment.isPending}
                error={enrichment.error}
                emptyMessage="No provider has been asked about this record yet. The enrichment pass picks up what it has not seen, oldest first."
            />
        </Stack>
    );
}

/** Which providers hold a copy, and what the station has of each. The answer to "why will this not play". */
function BindingsCard({ detail }: { detail: TrackDetail }) {
    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Eyebrow>Copies</Eyebrow>
                    <Title order={2} size="h5">
                        Where this record comes from
                    </Title>
                </Stack>

                {detail.bindings.length === 0 ? (
                    <EmptyState>
                        No provider holds a copy of this record, so nothing can play it. That is usually an import whose lookup never resolved.
                    </EmptyState>
                ) : (
                    <Table verticalSpacing="xs" horizontalSpacing="sm">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Provider</Table.Th>
                                <Table.Th>State</Table.Th>
                                <Table.Th>Format</Table.Th>
                                <Table.Th ta="right">Held</Table.Th>
                                <Table.Th ta="right">Last played from</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {detail.bindings.map(binding => {
                                const status = bindingStatus(binding);
                                return (
                                    <Table.Tr key={binding.sourceId}>
                                        <Table.Td>
                                            <Stack gap="xxxs">
                                                <Group gap="xxs">
                                                    <Text size="sm">{binding.pluginId}</Text>
                                                    {/* A discovered copy is in no playlist, which is why the
                                                        sync's sweep may not judge it. Worth saying on a page
                                                        about why a record behaves as it does. */}
                                                    {binding.origin === 'discovered' ? (
                                                        <Tooltip label="Looked up by name when something chose this record, rather than seen in a playlist.">
                                                            <Badge size="xs" variant="light" color="grape">
                                                                found
                                                            </Badge>
                                                        </Tooltip>
                                                    ) : undefined}
                                                </Group>
                                                <Text size="xs" c="dimmed">
                                                    {binding.externalId}
                                                </Text>
                                            </Stack>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label={status.detail} multiline w={280}>
                                                <span>
                                                    <StatusLamp tone={status.tone} label={status.label} />
                                                </span>
                                            </Tooltip>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text size="sm" c="dimmed">
                                                {binding.format ?? '—'}
                                                {binding.bitrate === undefined ? '' : ` • ${Math.round(binding.bitrate / 1000)}k`}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td ta="right" className="da-num">
                                            {formatBytes(binding.byteSize)}
                                        </Table.Td>
                                        <Table.Td ta="right" className="da-num">
                                            {moment(binding.lastServedAt)}
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                )}
            </Stack>
        </Card>
    );
}

/**
 * What the sidecar made of the record.
 *
 * `complete` and `analyzedAt` are shown separately, because a measurement of a truncated download is
 * confident and wrong: a date alone would report a record as measured that no reader will use the
 * measurement of.
 */
function MeasurementCard({ detail }: { detail: TrackDetail }) {
    const analysis = detail.analysis;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Eyebrow>Measurement</Eyebrow>
                    <Title order={2} size="h5">
                        Cue points and loudness
                    </Title>
                </Stack>

                {analysis === undefined ? (
                    <EmptyState>
                        Nothing has measured this record yet. It plays perfectly well unmeasured — without the measurement the station cannot trim
                        the silence off either end or set the level before air.
                    </EmptyState>
                ) : (
                    <Group gap="xl" wrap="wrap">
                        <Figure label="State">
                            {/* `complete` decides the tone rather than `analyzedAt`, because a
                                measurement of a truncated download carries a date and is wrong. */}
                            <StatusLamp
                                tone={analysis.failedAt !== undefined ? 'fault' : analysis.complete ? 'ok' : 'off'}
                                label={analysis.failedAt !== undefined ? 'Failed' : analysis.complete ? 'Measured' : 'Incomplete'}
                            />
                        </Figure>
                        {/* "Last measured" rather than "Measured", which is what the lamp beside it
                            already says — one word meaning both a state and a date is how a page
                            starts being read wrong. */}
                        <Figure label="Last measured">{moment(analysis.analyzedAt)}</Figure>
                        <Figure label="By">{analysis.analyzer ?? analysis.analyzerPluginId ?? '—'}</Figure>
                        <Figure label="Schema">{analysis.schemaVersion}</Figure>
                        {analysis.failureReason === undefined ? undefined : <Figure label="Why it failed">{analysis.failureReason}</Figure>}
                    </Group>
                )}
            </Stack>
        </Card>
    );
}

/** When this record has been on. The head of it, with the true total, since the feed is the log. */
function AiringsCard({ detail }: { detail: TrackDetail }) {
    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-end">
                    <Stack gap="xxs">
                        <Eyebrow>On air</Eyebrow>
                        <Title order={2} size="h5">
                            When this has played
                        </Title>
                    </Stack>
                    <Text size="sm" c="dimmed" className="da-num">
                        {detail.playCount} in all
                    </Text>
                </Group>

                {detail.plays.length === 0 ? (
                    <EmptyState>This record has not been on air yet.</EmptyState>
                ) : (
                    <Stack gap="xxs">
                        {detail.plays.map(play => (
                            <Group key={`${play.airedAt}-${play.source}`} justify="space-between">
                                <Text size="sm" className="da-num">
                                    {moment(play.airedAt)}
                                </Text>
                                <Text size="xs" c="dimmed">
                                    {play.source}
                                </Text>
                            </Group>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}

/**
 * One labelled fact.
 *
 * `component="div"` because several of these hold a `StatusLamp`, which is a group with a dot in
 * it: a paragraph containing a div is invalid HTML and React says so at runtime rather than
 * quietly.
 */
function Figure({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Stack gap="xxxs">
            <Eyebrow>{label}</Eyebrow>
            <Text component="div" size="sm">
                {children}
            </Text>
        </Stack>
    );
}
