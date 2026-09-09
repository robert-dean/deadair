import { Badge, Button, Card, Collapse, Group, Stack, Text } from '@mantine/core';
import { ActionIcon } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { PersonaAuditionBreak, PersonaAuditionSummary } from '@deadair/sdk';

import { usePersonaAudition } from '../../api/persona.auditions.queries';
import { fetchSpeechPreview } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { ErrorAlert } from '../shared/error.alert';
import { StatusLamp } from '../shared/status.lamp';
import { type StatusTone } from '../shared/status';
import { Attempt } from './persona.rehearsal';

/**
 * One run of a character through a playlist.
 *
 * Closed, it is a progress line: how far along, where the records came from, and a way to stop it.
 * Open, it is the thing an operator came for — the breaks in order, each with every writer that was
 * asked underneath it, so the model's line and the floor's line beneath it can be read together.
 *
 * ## The breaks are fetched only when the card is opened
 *
 * The list read carries no breaks at all, deliberately: a page showing twenty runs must not read
 * every break of every one. So opening a card is a second request, and closing it stops the polling
 * that came with it. That is the same bargain the notebook and stories panels make on the personas
 * page — one open at a time, because every open panel is a request nobody asked for.
 */
export function PersonaAuditionCard({
    personaId,
    run,
    voice,
    open,
    onToggle,
    onCancel,
    stopping,
}: {
    personaId: string;
    run: PersonaAuditionSummary;
    voice?: string;
    open: boolean;
    onToggle: () => void;
    onCancel: () => void;
    stopping: boolean;
}) {
    const detail = usePersonaAudition(personaId, open ? run.id : '');
    const unsettled = run.state === 'queued' || run.state === 'running';

    return (
        <Card withBorder padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                    <Stack gap="xxs">
                        <Group gap="xs" wrap="nowrap">
                            <StatusLamp tone={toneFor(run.state)} label={labelFor(run.state)} />
                            <Text size="sm" className="da-num">
                                {run.written} / {run.transitions}
                            </Text>
                            {run.written > 0 ? <Tally breaks={detail.data?.breaks ?? []} /> : undefined}
                        </Group>
                        <Text size="xs" c="dimmed">
                            {run.source.name ?? run.source.playlistId} — {run.source.pluginId}
                        </Text>
                    </Stack>

                    <Group gap="xs" wrap="nowrap">
                        <Button variant="subtle" size="compact-sm" onClick={onToggle} disabled={run.written === 0}>
                            {open ? 'Hide' : 'Read'}
                        </Button>
                        {unsettled ? (
                            <Button variant="subtle" size="compact-sm" color="red" loading={stopping} onClick={onCancel}>
                                Stop
                            </Button>
                        ) : undefined}
                    </Group>
                </Group>

                {/* A run that stopped for a reason nobody chose. Cancelling is not one of these:
                    that is a state, and the lamp already says it. */}
                {run.error ? (
                    <Text size="sm" c="red.4">
                        {run.error}
                    </Text>
                ) : undefined}

                {run.written === 0 && unsettled ? (
                    <Text size="sm" c="dimmed">
                        Queued. Each break waits for the model behind everything the station is doing for itself, so this fills in slowly.
                    </Text>
                ) : undefined}

                <Collapse expanded={open}>
                    {detail.isError ? <ErrorAlert title="Could not read this audition" error={detail.error} /> : undefined}
                    <Stack gap="md" mt="xs">
                        {(detail.data?.breaks ?? []).map(written => (
                            <Transition key={written.ordinal} written={written} {...(voice === undefined ? {} : { voice })} />
                        ))}
                    </Stack>
                </Collapse>
            </Stack>
        </Card>
    );
}

/**
 * One transition: the two records, and everything the writers said between them.
 *
 * The winner can be HEARD, on the rehearsal panel's argument: what a character sounds like is the
 * thing being judged, and reading a break off a screen is not that — the diction that reads as
 * overdone is frequently the half that works out loud. It renders through the sample store, so it
 * has no segment row and cannot be planted or aired.
 */
function Transition({ written, voice }: { written: PersonaAuditionBreak; voice?: string }) {
    const preview = useVoicePreview();
    const spoken = written.script;

    return (
        <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed" className="da-num">
                    {written.ordinal + 1}
                </Text>
                <Text size="xs" c="dimmed">
                    between {written.previous.title} and {written.next.title}
                </Text>
                {spoken ? (
                    <ActionIcon
                        variant="subtle"
                        size="sm"
                        loading={preview.isLoading(spoken)}
                        aria-label={`Hear break ${written.ordinal + 1}`}
                        onClick={() => preview.play(spoken, () => fetchSpeechPreview(spoken, voice), 'That break could not be spoken.')}
                    >
                        {preview.isPlaying(spoken) ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                    </ActionIcon>
                ) : undefined}
            </Group>

            {spoken && preview.failureFor(spoken) ? (
                <Text size="xs" c="red.4">
                    {preview.failureFor(spoken)}
                </Text>
            ) : undefined}

            {written.attempts.map((attempt, index) => (
                <Attempt key={`${attempt.writer}-${index}`} attempt={attempt} />
            ))}

            {written.script === undefined && written.reason !== undefined ? (
                <Text size="sm" c="dimmed">
                    {written.reason} — on air this break would be skipped, and the station would go straight to the next record.
                </Text>
            ) : undefined}
        </Stack>
    );
}

/**
 * The run in one line: how often the model wrote, and how often the floor covered.
 *
 * This is the number the whole feature exists to produce. `scripts/break.declines.ts` reports it
 * after the fact from what already aired, which means a sheet change is judged an evening later; the
 * same ratio over a playlist is that judgement before anything goes out.
 *
 * Drawn only when the breaks have been read, since it is counted from them rather than stored.
 */
function Tally({ breaks }: { breaks: readonly PersonaAuditionBreak[] }) {
    if (breaks.length === 0) return undefined;

    const model = breaks.filter(written => written.writer === 'model').length;
    const declined = breaks.filter(written => written.attempts.some(attempt => attempt.outcome === 'declined')).length;
    const failed = breaks.filter(written => written.attempts.some(attempt => attempt.outcome === 'failed')).length;

    return (
        <Group gap="xxs" wrap="nowrap">
            <Badge size="xs" variant="light" color="teal">
                {model} by the model
            </Badge>
            {declined > 0 ? (
                <Badge size="xs" variant="light" color="yellow">
                    {declined} declined
                </Badge>
            ) : undefined}
            {failed > 0 ? (
                <Badge size="xs" variant="light" color="red">
                    {failed} failed
                </Badge>
            ) : undefined}
        </Group>
    );
}

/**
 * A run's state as a tone.
 *
 * `cancelled` is `off` rather than a fault: somebody chose it, and what it wrote is still worth
 * reading. Only `failed` is something to go and look at.
 */
function toneFor(state: string): StatusTone {
    if (state === 'running') return 'live';
    if (state === 'done') return 'ok';
    if (state === 'failed') return 'fault';
    if (state === 'cancelled') return 'off';
    return 'standby';
}

/** What each state is called on the card, which is not always what the column holds. */
function labelFor(state: string): string {
    if (state === 'queued') return 'Waiting for the model';
    if (state === 'running') return 'Writing';
    if (state === 'done') return 'Finished';
    if (state === 'failed') return 'Stopped by a fault';
    return 'Stopped';
}
