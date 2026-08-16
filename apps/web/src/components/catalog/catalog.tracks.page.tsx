import { Fragment } from 'react';
import { Anchor, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { CATALOG_PAGE_SIZE, catalogTracksOptions, useRateTrack } from '../../api/catalog.queries';
import { formatDuration } from '../shared/format.duration';
import { Artwork } from '../shared/artwork';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { CatalogPagination } from './catalog.pagination';
import type { TrackStateParam } from './catalog.page.params';
import { CatalogSearch } from './catalog.search';
import { RatingControl } from './rating.control';
import { TrackStateFilter } from './track.state.filter';
import { TrackEnrichmentRow, TrackExpandButton, useTrackExpansion } from './track.expansion';

export interface CatalogTracksPageProps {
    page: number;
    search: string;
    state: TrackStateParam | '';
    onPageChange: (page: number) => void;
    onSearchChange: (search: string) => void;
    onStateChange: (state: TrackStateParam | '') => void;
}

/**
 * One of the three state marks on a row.
 *
 * A letter rather than a word, and dimmed rather than absent when it is false: a column of present
 * and missing words would be unreadable at fifty rows, and a mark that vanished would make an
 * unmeasured record look like a rendering bug. The tooltip carries the sentence.
 */
function StateMark({ on, label, mark }: { on: boolean; label: string; mark: string }) {
    return (
        <Tooltip label={on ? `Has ${label}` : `No ${label}`}>
            <Text component="span" size="xs" ff="monospace" fw={600} c={on ? 'teal' : 'dimmed'} opacity={on ? 1 : 0.35} aria-label={label}>
                {mark}
            </Text>
        </Tooltip>
    );
}

/**
 * Every track, flat.
 *
 * The drill-down cannot answer "do we have this song?" without already knowing whose it is, which
 * is the question the operator actually arrives with.
 */
export function CatalogTracksPage({ page, search, state, onPageChange, onSearchChange, onStateChange }: CatalogTracksPageProps) {
    const tracks = useQuery(catalogTracksOptions({ page, search, state }));
    const rows = tracks.data?.data ?? [];
    const expansion = useTrackExpansion();
    const rate = useRateTrack();

    return (
        <Stack gap="lg">
            <Stack gap={4}>
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={props => <Link to="/catalog" {...props} />} size="sm">
                    Back to catalog
                </Anchor>
                <PageHeader
                    title="Tracks"
                    description={
                        <Text c="dimmed" size="sm">
                            Every track the station has ingested.
                        </Text>
                    }
                />
            </Stack>

            <CatalogSearch value={search} placeholder="Search tracks" onChange={onSearchChange} />

            {/* Under the search rather than over it: the counts describe whatever the search has
                narrowed to, and reading them above the box they answer to would be backwards. */}
            <TrackStateFilter counts={tracks.data?.states} value={state} onChange={onStateChange} />

            {tracks.error ? (
                <ErrorAlert title="The tracks could not be loaded" error={tracks.error} fallback="The catalog is unavailable." />
            ) : undefined}

            {tracks.isPending ? <PageSkeleton variant="table" /> : undefined}

            {tracks.data && rows.length === 0 ? (
                <EmptyState title={search === '' ? 'The catalog is empty' : `Nothing matches “${search}”`}>
                    {search === ''
                        ? 'The catalog fills as enabled plugins are scanned. Nothing has been ingested yet.'
                        : 'Try a shorter term, or part of the title rather than all of it.'}
                </EmptyState>
            ) : undefined}

            {tracks.data && rows.length > 0 ? (
                <>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={52} />
                                <Table.Th w={44} />
                                <Table.Th>Title</Table.Th>
                                <Table.Th>Artist</Table.Th>
                                <Table.Th>Album</Table.Th>
                                <Table.Th w={120}>Duration</Table.Th>
                                <Table.Th w={110}>State</Table.Th>
                                <Table.Th w={150}>Rating</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.map(track => (
                                <Fragment key={track.id}>
                                    <Table.Tr>
                                        {/* The record's cover, since nothing hangs art off a recording. Blank for a
                                        single ingested outside any release, which has no record to borrow from. */}
                                        <Table.Td>
                                            <Artwork src={track.albumImageUrl} alt={track.albumName ?? track.title} size={36} />
                                        </Table.Td>
                                        <Table.Td>
                                            <TrackExpandButton
                                                open={expansion.isOpen(track.id)}
                                                title={track.title}
                                                onToggle={() => {
                                                    expansion.toggle(track.id);
                                                }}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            {/* `renderRoot` rather than `component={Link}`: the
                                                polymorphic form erases the router's own typing. */}
                                            <Anchor
                                                renderRoot={props => <Link to="/catalog/tracks/$trackId" params={{ trackId: track.id }} {...props} />}
                                                size="sm"
                                                c="inherit"
                                                underline="hover"
                                            >
                                                {track.title}
                                            </Anchor>
                                        </Table.Td>
                                        <Table.Td>
                                            <Anchor
                                                renderRoot={props => (
                                                    <Link to="/catalog/artists/$artistId" params={{ artistId: track.artistId }} {...props} />
                                                )}
                                            >
                                                {track.artistName}
                                            </Anchor>
                                        </Table.Td>
                                        {/* A track ingested outside any release has no album, which is a
                                        blank cell rather than a broken link. */}
                                        <Table.Td>
                                            {track.albumId === undefined ? (
                                                ''
                                            ) : (
                                                <Anchor
                                                    renderRoot={props => (
                                                        <Link to="/catalog/albums/$albumId" params={{ albumId: track.albumId }} {...props} />
                                                    )}
                                                >
                                                    {track.albumName}
                                                </Anchor>
                                            )}
                                        </Table.Td>
                                        <Table.Td className="da-num">{formatDuration(track.durationMs)}</Table.Td>
                                        {/* Three facts, as three marks rather than three columns: what
                                            a row can afford is a glance, and anything more detailed is
                                            the record's own page one click away. */}
                                        <Table.Td>
                                            <Group gap={6} wrap="nowrap">
                                                <StateMark on={track.hasAudio} label="audio on this machine" mark="A" />
                                                <StateMark on={track.measured} label="measured" mark="M" />
                                                <StateMark on={track.enriched} label="described by a provider" mark="E" />
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <RatingControl
                                                size="xs"
                                                rating={track.rating}
                                                label={track.title}
                                                busy={rate.isPending && rate.variables?.id === track.id}
                                                onChange={rating => {
                                                    rate.mutate({ id: track.id, rating });
                                                }}
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                    {/* One wider than the row above it, so the expansion still spans
                                        the table now that the rating has its own column. */}
                                    <TrackEnrichmentRow trackId={track.id} open={expansion.isOpen(track.id)} colSpan={8} />
                                </Fragment>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <CatalogPagination total={tracks.data.meta.total} pageSize={CATALOG_PAGE_SIZE} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
