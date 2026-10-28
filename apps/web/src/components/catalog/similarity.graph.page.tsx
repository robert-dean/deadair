import { useMemo } from 'react';
import { Box, Group, Stack, Switch, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SimilarityGraph } from '@deadair/sdk';

import { SIMILARITY_GRAPH_LIMIT, catalogSimilarityOptions } from '../../api/catalog.queries';
import { ArtistLink } from '../shared/catalog.links';
import { EmptyState } from '../shared/empty.state';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { QueryView } from '../shared/query.view';
import { SimilarityCanvas } from './similarity.canvas';
import { layoutGraph, type PlacedGraph } from './similarity.layout';

export interface SimilarityGraphPageProps {
    /** Only artists the catalog holds, carried in the URL. */
    library: boolean;
    onLibraryChange: (library: boolean) => void;
    onOpenArtist: (artistId: string) => void;
}

/** How many of the most-joined artists are listed under the drawing. */
const MOST_CONNECTED = 12;

/**
 * Who the similarity sources say sounds like whom, as one map.
 *
 * What it draws is the store and nothing fresher (`GET /catalog/similarity` never asks a source), so
 * the map is the station's own memory of what it has looked up, which grows with what it plays. That
 * is why its empty state explains rather than apologises.
 *
 * The list under the drawing is not decoration: a canvas is one image to a screen reader, and the
 * artists most worth exploring from are the ones the list names, as links.
 */
export function SimilarityGraphPage({ library, onLibraryChange, onOpenArtist }: SimilarityGraphPageProps) {
    const { t } = useTranslation('catalog');
    const graph = useQuery(catalogSimilarityOptions({ library }));

    return (
        <Stack gap="lg">
            <PageHeader
                title={t('similarity.title')}
                description={
                    <Text c="dimmed" size="sm">
                        {t('similarity.description')}
                    </Text>
                }
            />

            <Switch label={t('similarity.libraryOnly')} checked={library} onChange={event => onLibraryChange(event.currentTarget.checked)} />

            <QueryView
                query={graph}
                skeleton={<PageSkeleton variant="table" />}
                errorTitle={t('similarity.loadFailedTitle')}
                errorFallback={t('similarity.loadFailedFallback')}
                isEmpty={data => data.edges.length === 0}
                empty={
                    library ? (
                        <EmptyState title={t('similarity.emptyLibrary.title')}>{t('similarity.emptyLibrary.body')}</EmptyState>
                    ) : (
                        <EmptyState title={t('similarity.empty.title')}>{t('similarity.empty.body')}</EmptyState>
                    )
                }
            >
                {data => <SimilarityMap data={data} onOpenArtist={onOpenArtist} />}
            </QueryView>
        </Stack>
    );
}

function SimilarityMap({ data, onOpenArtist }: { data: SimilarityGraph; onOpenArtist: (artistId: string) => void }) {
    const { t } = useTranslation('catalog');
    const placed: PlacedGraph = useMemo(() => layoutGraph(data), [data]);
    const hubs = useMemo(
        () =>
            [...placed.nodes]
                .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
                .slice(0, MOST_CONNECTED)
                .filter(node => node.degree > 0),
        [placed],
    );

    return (
        <Stack gap="sm">
            <Group justify="space-between" gap="sm">
                <Group gap="md">
                    <Text size="sm" className="da-num">
                        {t('similarity.artists', { count: placed.nodes.length })}
                    </Text>
                    <Text size="sm" className="da-num">
                        {t('similarity.connections', { count: placed.links.length })}
                    </Text>
                    {data.truncated ? (
                        <Text size="sm" c="dimmed">
                            {t('similarity.truncated', { limit: SIMILARITY_GRAPH_LIMIT })}
                        </Text>
                    ) : undefined}
                </Group>
                <Group gap="md">
                    <LegendDot colour="var(--da-series-a)" label={t('similarity.legend.inLibrary')} />
                    <LegendDot colour="var(--da-text-dimmed)" label={t('similarity.legend.notInLibrary')} />
                    <Text size="xs" c="dimmed">
                        {t('similarity.legend.mutual')}
                    </Text>
                </Group>
            </Group>

            <SimilarityCanvas graph={placed} onOpenArtist={onOpenArtist} />

            <Text size="xs" c="dimmed">
                {t('similarity.hint')}
            </Text>

            <Stack gap={6}>
                <Text size="sm" fw={600}>
                    {t('similarity.mostConnected')}
                </Text>
                <Group gap="md">
                    {hubs.map(node => (
                        <Group key={node.key} gap={6} wrap="nowrap">
                            {node.artistId === undefined ? (
                                <Text size="sm" c="dimmed">
                                    {node.name}
                                </Text>
                            ) : (
                                <ArtistLink id={node.artistId} size="sm">
                                    {node.name}
                                </ArtistLink>
                            )}
                            <Text size="xs" c="dimmed" className="da-num">
                                {node.degree}
                            </Text>
                        </Group>
                    ))}
                </Group>
            </Stack>
        </Stack>
    );
}

function LegendDot({ colour, label }: { colour: string; label: string }) {
    return (
        <Group gap={6} wrap="nowrap">
            <Box w={10} h={10} style={{ borderRadius: '50%', background: colour }} />
            <Text size="xs" c="dimmed">
                {label}
            </Text>
        </Group>
    );
}
