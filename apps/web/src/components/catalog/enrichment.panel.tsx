import { useState } from 'react';
import { Anchor, Badge, Button, Card, Code, Collapse, Group, List, SimpleGrid, Spoiler, Stack, Text } from '@mantine/core';

import { formatDate } from '../shared/format.date';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * The union of the three payload shapes the API reports.
 *
 * One type rather than three, because the differences are absences: an artist has no tempo, an
 * album has no ISRC, and every field on all three is optional anyway. A panel that branched on
 * which entity it was rendering would be three panels drifting apart.
 */
export interface EnrichmentFacts {
    year?: number;
    releaseDate?: string;
    label?: string;
    bpm?: number;
    musicalKey?: string;
    isrc?: string;
    biography?: string;
    genres?: string[];
    moods?: string[];
    facts?: string[];
    externalIds?: { source: string; id: string }[];
    links?: { label: string; url: string }[];
    extra?: Record<string, unknown>;
}

/** One provider's row, without the payload: who answered, when, and whether they had anything. */
export interface EnrichmentProvenance {
    provider: string;
    providerRef?: string;
    fetchedAt: string;
    expiresAt?: string;
    stale: boolean;
    found: boolean;
}

export interface EnrichmentPanelProps {
    merged?: EnrichmentFacts;
    sources?: EnrichmentProvenance[];
    isPending: boolean;
    error: unknown;
    /** What to say when the walk has stored nothing for this row. Names the entity. */
    emptyMessage: string;
}

/** The scalar fields, in the order they are worth reading, dropping the ones nobody resolved. */
function detailPairs(merged: EnrichmentFacts): [string, string][] {
    const pairs: [string, string][] = [];
    const push = (label: string, value: string | number | undefined) => {
        if (value !== undefined && value !== '') pairs.push([label, String(value)]);
    };

    // `releaseDate` is preferred over `year` when it says more than the year alone does.
    push('Released', merged.releaseDate !== undefined && merged.releaseDate.length > 4 ? merged.releaseDate : merged.year);
    push('Label', merged.label);
    push('BPM', merged.bpm);
    push('Key', merged.musicalKey);
    push('ISRC', merged.isrc);

    return pairs;
}

/**
 * What the enrichment providers said about one artist, record or recording.
 *
 * Presentational on purpose: the caller runs the query, so the same panel serves a detail page that
 * loads with the row and a table row that fetches only once it is opened.
 *
 * The provenance footer is not decoration. Everything above it is a claim by some upstream, and an
 * operator looking at a wrong genre or a missing fact needs to know which source to go and correct
 * and how old the answer is. A provider that was asked and had nothing is listed too: silence from
 * a source and never having asked it are different states, and only one of them is worth waiting
 * out.
 */
/**
 * The fields a provider returned that the SDK has no name for.
 *
 * Shown as what they are — raw JSON, behind a toggle — rather than rendered as though the console
 * knew what the keys meant. It cannot: that is the whole point of the bag, and a plugin can add to
 * it without an SDK release. Collapsed by default because it is a debugging affordance, not
 * something an operator reads while looking at a record.
 */
function UnmappedFields({ extra }: { extra: Record<string, unknown> }) {
    const [open, setOpen] = useState(false);
    const count = Object.keys(extra).length;

    return (
        <Stack gap="xs" align="flex-start">
            <Button
                variant="subtle"
                size="compact-xs"
                onClick={() => {
                    setOpen(current => !current);
                }}
            >
                {open ? 'Hide' : `Show ${count} unmapped field${count === 1 ? '' : 's'}`}
            </Button>
            <Collapse expanded={open}>
                <Code block>{JSON.stringify(extra, undefined, 2)}</Code>
            </Collapse>
        </Stack>
    );
}

export function EnrichmentPanel({ merged, sources, isPending, error, emptyMessage }: EnrichmentPanelProps) {
    if (isPending) return <PageSkeleton variant="card" />;

    if (error) {
        return <ErrorAlert title="The enrichment could not be loaded" error={error} fallback="The catalog is unavailable." />;
    }

    const facts = merged ?? {};
    const rows = sources ?? [];
    const pairs = detailPairs(facts);
    const tags = [...(facts.genres ?? []), ...(facts.moods ?? [])];
    const extraKeys = Object.keys(facts.extra ?? {});

    if (rows.length === 0) {
        return (
            <Card padding="lg">
                <Text size="sm" c="dimmed">
                    {emptyMessage}
                </Text>
            </Card>
        );
    }

    return (
        <Card padding="lg">
            <Stack gap="md">
                {tags.length > 0 ? (
                    <Group gap="xs">
                        {tags.map(tag => (
                            <Badge key={tag} variant="light">
                                {tag}
                            </Badge>
                        ))}
                    </Group>
                ) : undefined}

                {pairs.length > 0 ? (
                    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="xs">
                        {pairs.map(([label, value]) => (
                            <Stack key={label} gap={0}>
                                <Text size="xs" c="dimmed">
                                    {label}
                                </Text>
                                <Text size="sm">{value}</Text>
                            </Stack>
                        ))}
                    </SimpleGrid>
                ) : undefined}

                {facts.facts && facts.facts.length > 0 ? (
                    <List size="sm" spacing={4}>
                        {facts.facts.map(fact => (
                            <List.Item key={fact}>{fact}</List.Item>
                        ))}
                    </List>
                ) : undefined}

                {facts.biography ? (
                    <Spoiler maxHeight={72} showLabel="Read more" hideLabel="Show less">
                        <Text size="sm">{facts.biography}</Text>
                    </Spoiler>
                ) : undefined}

                {facts.links && facts.links.length > 0 ? (
                    <Group gap="md">
                        {/* Narrowed to http(s) by the host before it was ever stored. `noreferrer`
                            because these point at whatever an upstream said, not at us. */}
                        {facts.links.map(link => (
                            <Anchor key={link.url} href={link.url} target="_blank" rel="noreferrer" size="sm">
                                {link.label}
                            </Anchor>
                        ))}
                    </Group>
                ) : undefined}

                {facts.externalIds && facts.externalIds.length > 0 ? (
                    <Group gap="xs">
                        {facts.externalIds.map(id => (
                            <Text key={`${id.source}:${id.id}`} size="xs" c="dimmed">
                                {`${id.source}: ${id.id}`}
                            </Text>
                        ))}
                    </Group>
                ) : undefined}

                {extraKeys.length > 0 ? <UnmappedFields extra={facts.extra ?? {}} /> : undefined}

                <Group gap="xs">
                    {rows.map(source => (
                        <Badge key={source.provider} variant="outline" color={source.found ? undefined : 'gray'}>
                            {`${source.provider} • ${source.found ? formatDate(source.fetchedAt) : 'nothing found'}${source.stale ? ' • due again' : ''}`}
                        </Badge>
                    ))}
                </Group>
            </Stack>
        </Card>
    );
}
