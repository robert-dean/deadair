import { useState } from 'react';
import { Anchor, Badge, Box, Code, Collapse, Group, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { ScriptAttempt, ScriptOutcome } from '@deadair/sdk';

import { apiErrorMessage } from '../../api/sdk.error';
import { useRateScript, useScriptHistory } from '../../api/scripts.queries';
import { FeedMoment } from '../shared/dated.feed';
import { Eyebrow } from '../shared/eyebrow';
import { FeedPage } from '../shared/feed.page';
import { ScriptRatingControl } from './script.rating.control';
import { PageHeader } from '../shared/page.header';
import { StatusLamp } from '../shared/status.lamp';
import type { StatusTone } from '../shared/status';

const OUTCOMES: { value: ScriptOutcome | 'all'; label: string }[] = [
    { value: 'all', label: 'Everything' },
    { value: 'written', label: 'Written' },
    { value: 'declined', label: 'Declined' },
    { value: 'failed', label: 'Failed' },
];

/**
 * The two writers the station currently has, by their own `BreakWriter.name`.
 *
 * The API takes any string here, because a writer names itself and a third one needs no contract
 * change. These are the two that exist, so the filter offers them rather than deriving a list from
 * whichever rows happen to be loaded, which would offer fewer options the further back you read.
 */
const WRITERS: { value: string; label: string }[] = [
    { value: 'all', label: 'Any writer' },
    { value: 'model', label: 'Model' },
    { value: 'deterministic', label: 'Floor' },
];

/**
 * How an attempt reads, in the console's one status vocabulary.
 *
 * A decline is `standby` rather than a fault, and that is the whole point of this page: a model
 * that declined and let the floor write is the registry working exactly as designed, and painting
 * it as a failure would make a healthy station look broken. Only a `failed` attempt, where
 * something threw, is worth looking for.
 */
const OUTCOME_TONE: Record<ScriptOutcome, StatusTone> = {
    written: 'ok',
    declined: 'standby',
    failed: 'fault',
};

/**
 * What this page is, given what it has been narrowed to.
 *
 * The two narrowings do not compose in practice — nothing links to one break of one character — but
 * the break wins if they ever do, because it is the narrower of the two.
 */
function title(segmentId: string | undefined, personaKey: string | undefined): string {
    if (segmentId !== undefined) return 'One break';
    if (personaKey !== undefined) return `Everything ${personaKey} has said`;
    return 'Scripts';
}

function describe(segmentId: string | undefined, personaKey: string | undefined): string {
    if (segmentId !== undefined) return 'Every attempt at writing this one break, newest first, including the ones that came to nothing.';
    if (personaKey !== undefined) {
        return 'Every attempt this character has made, newest first. A run of declines with the floor writing underneath is what a sheet nothing can satisfy looks like.';
    }
    return 'Everything the station has written, newest first, one entry per attempt. A model that declined and the line that went out instead are both here.';
}

export interface ScriptsPageProps {
    /**
     * One break's attempts rather than the whole history, as a link off the running order asks for.
     *
     * The id is not resolved to anything here: what is drawn is the attempts themselves, and a
     * segment the library no longer holds still has every word it was ever given.
     */
    segmentId?: string;
    /**
     * One character's attempts rather than the whole history, as a link off the personas page asks
     * for.
     *
     * The KEY rather than the id, because that is what `script_history` stamps: the rows outlive
     * the persona, deliberately, so what a character said survives the character being deleted.
     */
    personaKey?: string;
}

/**
 * Everything the station has written, including what it decided not to say.
 *
 * One row per write ATTEMPT rather than per break, which is what makes this worth reading: a model
 * that declined and the floor that covered for it are two rows, and the second on its own reads as
 * a station that never had a model. The API unions nothing here and this page decides nothing; the
 * rows were written by the writers themselves as they ran.
 *
 * The prompt and the raw answer appear only for rows written while `llm.captureWrites` was on,
 * which is a switch for an evening of prompt tuning rather than a default. A row without them is
 * the ordinary case and says so.
 *
 * Narrowed to one break when a `segmentId` arrives, which is what a link off the running order
 * lands on, and to one character when a `personaKey` does, which is what a link off the personas
 * page lands on. Both are a QUERY rather than a client-side sieve, so the pagination underneath
 * them still means what it says.
 */
export function ScriptsPage({ segmentId, personaKey }: ScriptsPageProps = {}) {
    const [outcome, setOutcome] = useState<ScriptOutcome | 'all'>('all');
    const [writer, setWriter] = useState<string>('all');

    const history = useScriptHistory(
        {
            ...(outcome === 'all' ? {} : { outcome }),
            ...(writer === 'all' ? {} : { writer }),
            ...(segmentId === undefined ? {} : { segmentId }),
            ...(personaKey === undefined ? {} : { personaKey }),
        },
        true,
    );

    const failure = history.isError ? apiErrorMessage(history.error, 'The script history could not be read.') : undefined;

    return (
        <FeedPage
            query={history}
            itemsFrom={page => page.attempts}
            failure={failure}
            emptyMessage={
                /* A break with no attempts is its own answer, and a different one: the break was
                   planted and nothing has been asked to write it yet. Reading that as "nothing
                   matches that filter" would send an operator looking for a filter to clear. */
                segmentId !== undefined && outcome === 'all' && writer === 'all'
                    ? 'Nothing has been written for this break yet. The station asks for the words as the slot comes near, not when the break is planted.'
                    : /* A character with no attempts has never been on air, which is a different
                         answer again from a filter matching nothing: there is nothing to clear and
                         nothing went wrong. */
                      personaKey !== undefined && outcome === 'all' && writer === 'all'
                      ? 'This character has not written anything yet. A row lands here on every attempt it makes, including the ones it declines.'
                      : outcome === 'all' && writer === 'all'
                        ? 'Nothing yet. The station writes here every time it makes a break, whether or not the words made it to air.'
                        : 'Nothing matches that filter.'
            }
            renderRow={attempt => <AttemptRow attempt={attempt} />}
        >
            <PageHeader
                title={title(segmentId, personaKey)}
                description={
                    <Text size="sm" c="dimmed">
                        {describe(segmentId, personaKey)}
                    </Text>
                }
            />

            {/* The way back out, and it says what it is narrowed to rather than only offering to
                clear it: an operator who followed a link off the running order or off a persona
                card and then paged through has to be able to tell this from the whole history. */}
            {segmentId === undefined && personaKey === undefined ? undefined : (
                <Group gap="xs">
                    <Anchor renderRoot={props => <Link to="/voice" search={{ tab: 'said', segment: '', persona: '' }} {...props} />} size="sm">
                        Read everything the station has written
                    </Anchor>
                </Group>
            )}

            <Group gap="md" wrap="wrap">
                <SegmentedControl
                    size="xs"
                    data={OUTCOMES}
                    value={outcome}
                    onChange={value => {
                        setOutcome(value as ScriptOutcome | 'all');
                    }}
                />
                <SegmentedControl size="xs" data={WRITERS} value={writer} onChange={setWriter} />
            </Group>
        </FeedPage>
    );
}

interface AttemptRowProps {
    attempt: ScriptAttempt;
}

/**
 * One attempt, with its detail behind a click.
 *
 * The row carries what an operator scans for — when, who wrote it, and the words — and everything
 * that answers "why did it come out like that" is in the panel underneath. Collapsed by default
 * because the prompt is thousands of words and the point of the list is to read the station's voice
 * a dozen lines at a time.
 */
function AttemptRow({ attempt }: AttemptRowProps) {
    const [open, setOpen] = useState(false);
    const rate = useRateScript();

    // A declined or failed attempt has no words, so the reason takes the line the script would have
    // had. Without it the row is a timestamp and a badge saying nothing happened.
    const line = attempt.script ?? attempt.reason ?? '';

    return (
        <Stack gap={0}>
            {/* The row's button and the rating sit SIDE BY SIDE rather than nested. A control inside
                the button would be a button inside a button, which is invalid and would open the
                detail on every click of a thumb. */}
            <Group gap="xs" wrap="nowrap" align="flex-start" pr="md">
                <UnstyledButton
                    px="md"
                    py="xs"
                    style={{ flex: 1, minWidth: 0 }}
                    onClick={() => {
                        setOpen(value => !value);
                    }}
                >
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                        <FeedMoment at={attempt.at} />

                        <Box style={{ flexShrink: 0 }}>
                            <StatusLamp tone={OUTCOME_TONE[attempt.outcome]} label={attempt.outcome} />
                        </Box>

                        <Badge size="xs" variant="light" color={attempt.writer === 'model' ? 'grape' : 'gray'} tt="none" style={{ flexShrink: 0 }}>
                            {attempt.writer}
                        </Badge>

                        <Text size="sm" c={attempt.script === undefined ? 'dimmed' : undefined} style={{ minWidth: 0, textAlign: 'left' }}>
                            {line}
                        </Text>
                    </Group>
                </UnstyledButton>

                {/* Only where there are words to have an opinion about. An attempt that declined or
                    failed produced no script, and asking what the operator thought of a sentence
                    that was never written is a question with no subject. */}
                {attempt.script === undefined ? undefined : (
                    <Box pt="xs" style={{ flexShrink: 0 }}>
                        <ScriptRatingControl
                            rating={attempt.rating}
                            busy={rate.isPending && rate.variables?.id === attempt.id}
                            onChange={rating => {
                                rate.mutate({ id: attempt.id, rating });
                            }}
                        />
                    </Box>
                )}
            </Group>

            {/* Unmounted rather than hidden while collapsed: a page of fifty rows each holding a
                few thousand words of prompt is worth not putting in the DOM to save a transition. */}
            <Collapse expanded={open} keepMounted={false}>
                <AttemptDetail attempt={attempt} />
            </Collapse>
        </Stack>
    );
}

/** Everything about one attempt that is not the sentence it produced. */
function AttemptDetail({ attempt }: { attempt: ScriptAttempt }) {
    const tokens = attempt.usage?.totalTokens ?? attempt.usage?.outputTokens;

    return (
        <Stack gap="sm" px="md" pt="xs" pb="md" style={{ background: 'var(--da-raised)' }}>
            <Group gap="lg" wrap="wrap">
                <Fact label="Kind" value={attempt.kind} />
                {/* Absent means nobody was presenting, which is an ordinary state rather than a gap. */}
                {attempt.personaKey === undefined ? undefined : <Fact label="Host" value={attempt.personaKey} />}
                {attempt.model === undefined ? undefined : <Fact label="Model" value={attempt.model} />}
                {attempt.source === undefined ? undefined : <Fact label="From" value={attempt.source} />}
                {attempt.durationMs === undefined ? undefined : <Fact label="Took" value={`${(attempt.durationMs / 1000).toFixed(1)}s`} numeric />}
                {tokens === undefined ? undefined : <Fact label="Tokens" value={String(tokens)} numeric />}
            </Group>

            {attempt.previous !== undefined || attempt.next !== undefined ? (
                <Group gap="lg" wrap="wrap" align="flex-start">
                    {attempt.previous === undefined ? undefined : <Neighbour label="After" track={attempt.previous} />}
                    {attempt.next === undefined ? undefined : <Neighbour label="Before" track={attempt.next} />}
                </Group>
            ) : undefined}

            {/* Shown for a written attempt too: a model that produced words and a reason produced both. */}
            {attempt.reason !== undefined && attempt.script !== undefined ? <Fact label="Note" value={attempt.reason} /> : undefined}

            {attempt.raw === undefined ? undefined : (
                <Stack gap="xxs">
                    <Eyebrow>Answer, before anything read it</Eyebrow>
                    <Code block style={WRAP}>
                        {attempt.raw}
                    </Code>
                </Stack>
            )}

            {attempt.prompt === undefined ? (
                <Text size="xs" c="dimmed">
                    The prompt was not kept. Turn on <Code>llm.captureWrites</Code> to keep it for the attempts after this one.
                </Text>
            ) : (
                <Stack gap="xxs">
                    <Eyebrow>What it was sent</Eyebrow>
                    {attempt.prompt.map((message, index) => (
                        <Stack key={index} gap="xxxs">
                            <Text size="xs" c="dimmed" tt="uppercase">
                                {message.role}
                            </Text>
                            <Code block style={WRAP}>
                                {message.content}
                            </Code>
                        </Stack>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

/**
 * A prompt is one very long line as often as not, and `Code block` does not wrap.
 *
 * Left unwrapped it clips at the card edge rather than scrolling, so the half of a system turn that
 * matters is simply not on screen. `break-word` as well as `pre-wrap` because a prompt can carry a
 * URL or a run of punctuation with nowhere to break.
 */
const WRAP = { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as const;

function Fact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
    return (
        <Stack gap={0}>
            <Eyebrow>{label}</Eyebrow>
            <Text size="sm" className={numeric ? 'da-num' : undefined}>
                {value}
            </Text>
        </Stack>
    );
}

/** A record the writer was told about, and what it was told. */
function Neighbour({ label, track }: { label: string; track: NonNullable<ScriptAttempt['previous']> }) {
    return (
        <Stack gap="xxxs" style={{ maxWidth: 420 }}>
            <Eyebrow>{label}</Eyebrow>
            <Text size="sm">
                {track.title}{' '}
                <Text span c="dimmed">
                    {track.artist}
                </Text>
            </Text>
            {track.facts?.map((fact, index) => (
                <Text key={index} size="xs" c="dimmed">
                    {fact}
                </Text>
            ))}
        </Stack>
    );
}
