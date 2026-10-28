import { useMemo, useState } from 'react';
import { Anchor, Card, Group, SegmentedControl, Skeleton, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SimilarityGraph } from '@deadair/sdk';

import { catalogSimilarityOptions } from '../../api/catalog.queries';
import { ArtistLink } from '../shared/catalog.links';
import { ErrorAlert } from '../shared/error.alert';
import { Eyebrow } from '../shared/eyebrow';
import { SimilarityCanvas } from './similarity.canvas';
import { layoutGraph } from './similarity.layout';

export interface SimilarityNeighbourhoodCardProps {
    artistId: string;
    /** The artist's name, for the sentence that says nobody has been asked about them yet. */
    artistName?: string;
    onOpenArtist: (artistId: string) => void;
}

const HEIGHT = 340;

/**
 * Who sounds like this artist, as the station has stored it, one or two steps out.
 *
 * The Library's Similar map reads the whole store; this reads one artist's corner of it, which is
 * the question an operator on an artist's page is asking. Two steps rather than one is a switch
 * rather than the default, because the second step is where a scene meets the next one, and at
 * one step the drawing stays about this artist.
 *
 * The direct neighbours are also listed, as links where the library holds them, for the reason the
 * map page lists its hubs: the canvas is one image to a screen reader.
 */
export function SimilarityNeighbourhoodCard({ artistId, artistName, onOpenArtist }: SimilarityNeighbourhoodCardProps) {
    const { t } = useTranslation('catalog');
    const [depth, setDepth] = useState<1 | 2>(1);
    const graph = useQuery(catalogSimilarityOptions({ library: false, around: artistId, depth }));

    return (
        <Card padding="lg">
            <Stack gap="sm">
                <Group justify="space-between" gap="sm">
                    <Eyebrow>{t('similarity.neighbourhood.title')}</Eyebrow>
                    <Group gap="md">
                        <SegmentedControl
                            size="xs"
                            aria-label={t('similarity.neighbourhood.depthLabel')}
                            value={String(depth)}
                            onChange={value => setDepth(value === '2' ? 2 : 1)}
                            data={[
                                { value: '1', label: t('similarity.neighbourhood.oneStep') },
                                { value: '2', label: t('similarity.neighbourhood.twoSteps') },
                            ]}
                        />
                        <Anchor size="sm" renderRoot={(props: object) => <Link to="/catalog/similarity" search={{ library: false }} {...props} />}>
                            {t('similarity.neighbourhood.fullMap')}
                        </Anchor>
                    </Group>
                </Group>

                {graph.error ? (
                    <ErrorAlert title={t('similarity.loadFailedTitle')} error={graph.error} fallback={t('similarity.loadFailedFallback')} />
                ) : undefined}
                {graph.isPending ? <Skeleton height={HEIGHT} /> : undefined}
                {graph.data !== undefined && graph.data.edges.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        {t('similarity.neighbourhood.empty', { name: artistName ?? t('artist.fallbackTitle') })}
                    </Text>
                ) : undefined}
                {graph.data !== undefined && graph.data.edges.length > 0 ? (
                    <Neighbourhood data={graph.data} artistId={artistId} onOpenArtist={onOpenArtist} />
                ) : undefined}
            </Stack>
        </Card>
    );
}

function Neighbourhood({ data, artistId, onOpenArtist }: { data: SimilarityGraph; artistId: string; onOpenArtist: (artistId: string) => void }) {
    const { t } = useTranslation('catalog');
    const placed = useMemo(() => layoutGraph(data), [data]);
    const centre = placed.nodes.find(node => node.artistId === artistId);

    // Best-ranked first, whichever of the two named the other: the order the station would reach for them.
    const direct = useMemo(() => {
        if (centre === undefined) return [];
        return placed.links
            .filter(link => link.source === centre || link.target === centre)
            .sort((a, b) => b.weight - a.weight || Number(b.mutual) - Number(a.mutual))
            .map(link => (link.source === centre ? link.target : link.source));
    }, [placed, centre]);

    return (
        <Stack gap="sm">
            <SimilarityCanvas
                graph={placed}
                {...(centre === undefined ? {} : { centreKey: centre.key })}
                onOpenArtist={id => {
                    if (id !== artistId) onOpenArtist(id);
                }}
                height={HEIGHT}
            />
            {data.truncated ? (
                <Text size="xs" c="dimmed">
                    {t('similarity.neighbourhood.truncated')}
                </Text>
            ) : undefined}
            <Group gap="md">
                {direct.map(node =>
                    node.artistId === undefined ? (
                        <Text key={node.key} size="sm" c="dimmed">
                            {node.name}
                        </Text>
                    ) : (
                        <ArtistLink key={node.key} id={node.artistId} size="sm">
                            {node.name}
                        </ArtistLink>
                    ),
                )}
            </Group>
        </Stack>
    );
}
