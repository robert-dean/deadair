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
    /** The last attempt errored. Distinct from `found: false`, which is the provider having nothing. */
    failed: boolean;
}

/**
 * One thing the station believes, and the words it read that say so.
 *
 * Not a provider's payload: the host extracted this out of an article a plugin handed over, which
 * is why it carries a citation and a quote where the fields above carry only a source name.
 */
export interface EnrichmentClaim {
    id: string;
    claim: string;
    category: string;
    source: string;
    sourceUrl: string;
    sourceQuote: string;
    lastUsedAt?: string;
}

export interface EnrichmentPanelProps {
    merged?: EnrichmentFacts;
    sources?: EnrichmentProvenance[];
    claims?: EnrichmentClaim[];
    isPending: boolean;
    error: unknown;
    /** What to say when the walk has stored nothing for this row. Names the entity. */
    emptyMessage: string;
}

/**
 * What one provider's badge says, which is three states rather than two.
 *
 * "Nothing found" used to cover both a source that answered with nothing and a source that could
 * not be reached, and they are opposite facts: the first is settled and the second is the walk
 * still owing this record an answer. Only one of them is worth an operator's attention.
 */
const sourceState = (source: EnrichmentProvenance): string => {
    // A source can be both: what it said in May is still the best answer there is, and the walk
    // still could not reach it today. Showing only the date would hide the second half, and showing
    // only the failure would suggest the panel above it came from nowhere.
    if (source.failed) return source.found ? `${formatDate(source.fetchedAt)} • could not re-ask` : 'could not ask';
    return source.found ? formatDate(source.fetchedAt) : 'nothing found';
};

const badgeColor = (source: EnrichmentProvenance): string | undefined => {
    if (source.failed) return 'yellow';
    return source.found ? undefined : 'gray';
};

/** The scalar fields, in the order they are worth reading, dropping the ones nobody resolved. */
function detailPairs(merged: EnrichmentFacts): [string, string][] {
    const pairs: [string, string][] = [];
    const push = (label: string, value: string | number | undefined) => {
        if (value !== undefined && value !== '') pairs.push([label, String(value)]);
    };

    // `releaseDate` is preferred over `year` when it says more than the year alone does. Labelled
    // as the providers' own claim because a track page also shows `deadair.tracks.year`, the raw
    // tag off the ingested file, and the two disagree often enough that "Released" alone reads as
    // one fact rather than the two unreconciled ones it actually is.
    push('Providers say released', merged.releaseDate !== undefined && merged.releaseDate.length > 4 ? merged.releaseDate : merged.year);
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
                {/* Wrapped for the reason scripts.page.tsx wraps its prompts: a long value is one
                    long line, and `Code block` on its own scrolls the panel sideways instead. */}
                <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(extra, undefined, 2)}
                </Code>
            </Collapse>
        </Stack>
    );
}

/**
 * What the station believes, and where it read it.
 *
 * The quote is the reason this section exists at all. Everything else on this card is somebody
 * else's structured data, where being wrong looks like a missing genre; a claim is a sentence the
 * DJ will say out loud, and the only way to know whether it is true is to read the words it came
 * from and follow the link. So the quote is always there, one click away, rather than behind a
 * debugging affordance.
 *
 * `lead` and `model` are marked apart because they fail differently: the first is an article's own
 * opening sentence copied verbatim and can only be wrong if the article was, and the second is a
 * model's reading of one, checked but not certain.
 */
function Claims({ claims }: { claims: EnrichmentClaim[] }) {
    return (
        <Stack gap="sm">
            {claims.map(claim => (
                <Stack key={claim.id} gap="xxs">
                    <Group gap="xs" wrap="nowrap" align="baseline">
                        {/* `flexShrink: 0` because the claim beside it is a whole sentence and a
                            nowrap row squeezes the badge instead, which turns `summary` into
                            `SUMMA…` on exactly the long claims worth reading. */}
                        <Badge variant="light" color={claim.source === 'lead' ? 'gray' : 'grape'} size="sm" style={{ flexShrink: 0 }}>
                            {claim.category.replace(/_/g, ' ')}
                        </Badge>
                        <Text size="sm">{claim.claim}</Text>
                    </Group>
                    <Spoiler maxHeight={0} showLabel="Show the source" hideLabel="Hide the source">
                        <Stack gap="xxxs" pt="xxs">
                            <Text size="xs" c="dimmed" fs="italic">
                                {`“${claim.sourceQuote}”`}
                            </Text>
                            {/* Where an operator goes when something sounds wrong on air, which is
                                the entire reason a claim is worth anything. */}
                            <Anchor href={claim.sourceUrl} target="_blank" rel="noreferrer" size="xs">
                                {claim.sourceUrl}
                            </Anchor>
                        </Stack>
                    </Spoiler>
                </Stack>
            ))}
        </Stack>
    );
}

export function EnrichmentPanel({ merged, sources, claims, isPending, error, emptyMessage }: EnrichmentPanelProps) {
    if (isPending) return <PageSkeleton variant="card" />;

    if (error) {
        return <ErrorAlert title="The enrichment could not be loaded" error={error} fallback="The catalog is unavailable." />;
    }

    const facts = merged ?? {};
    const rows = sources ?? [];
    const beliefs = claims ?? [];
    const pairs = detailPairs(facts);
    const tags = [...(facts.genres ?? []), ...(facts.moods ?? [])];
    const extraKeys = Object.keys(facts.extra ?? {});

    if (rows.length === 0 && beliefs.length === 0) {
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

                {/* Above the providers' own `facts`, because these are the ones with a source
                    behind them and the ones the DJ reaches for first. */}
                {beliefs.length > 0 ? <Claims claims={beliefs} /> : undefined}

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
                        <Badge key={source.provider} variant="outline" color={badgeColor(source)}>
                            {`${source.provider} • ${sourceState(source)}${source.stale ? ' • due again' : ''}`}
                        </Badge>
                    ))}
                </Group>
            </Stack>
        </Card>
    );
}
