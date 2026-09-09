import { ActionIcon, Card, Group, Stack, Text } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from '@tabler/icons-react';
import type { PersonaRehearsal, PersonaRehearsalAttempt } from '@deadair/sdk';

import { fetchSpeechPreview } from '../../api/voices.queries';
import { useVoicePreview } from '../voices/voice.preview';
import { Eyebrow } from '../shared/eyebrow';
import { StatusLamp } from '../shared/status.lamp';
import { type StatusTone } from '../shared/status';

/**
 * What a persona said when it was asked for a break it will never air.
 *
 * Every writer that was asked is drawn, not only the one that won, because the interesting reading
 * is usually the pair: the model declined and the floor covered for it. Showing the winner alone
 * would make a sheet whose markers are impossible look exactly like a station with no model.
 *
 * Nothing here is a fault. A decline is the arrangement working and an empty answer is the station
 * telling the truth about a busy minute, so the strongest tone on this panel is `standby`.
 *
 * ## A script that won can be HEARD
 *
 * What a character sounds like is the thing being judged, and reading a break off a screen is not
 * that: the diction that reads as overdone on the page is frequently the half that works out loud,
 * and the rhythm never survives the eye at all. The preview renders through the sample store, so it
 * has no segment row and cannot be planted or aired — the same guarantee a voice sample has, for the
 * same reason. It is a button rather than something automatic because it spends a synthesis and
 * queues behind every break the station is about to put to air.
 */
export function PersonaRehearsalPanel({ rehearsal, voice }: { rehearsal: PersonaRehearsal; voice?: string }) {
    const preview = useVoicePreview();
    const spoken = rehearsal.script;

    return (
        <Card withBorder mt="sm" padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                        <Eyebrow>Rehearsal</Eyebrow>
                        {/* Only what actually won: the attempts below include the ones that came to
                            nothing, and an empty script has nothing to say out loud. */}
                        {spoken ? (
                            <ActionIcon
                                variant="subtle"
                                size="sm"
                                loading={preview.isLoading(spoken)}
                                aria-label="Hear this break"
                                onClick={() => preview.play(spoken, () => fetchSpeechPreview(spoken, voice), 'That break could not be spoken.')}
                            >
                                {preview.isPlaying(spoken) ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
                            </ActionIcon>
                        ) : undefined}
                    </Group>
                    <Text size="xs" c="dimmed" ta="right">
                        between {rehearsal.previous} and {rehearsal.next}
                    </Text>
                </Group>

                {spoken && preview.failureFor(spoken) ? (
                    <Text size="xs" c="red.4">
                        {preview.failureFor(spoken)}
                    </Text>
                ) : undefined}

                {rehearsal.attempts.map((attempt, index) => (
                    <Attempt key={`${attempt.writer}-${index}`} attempt={attempt} />
                ))}

                {rehearsal.attempts.length === 0 ? (
                    <Text size="sm" c="dimmed">
                        Nothing writes a talk break on this station.
                    </Text>
                ) : undefined}

                {rehearsal.script === undefined && rehearsal.reason !== undefined ? (
                    <Text size="sm" c="dimmed">
                        {rehearsal.reason} — on air this break would be skipped, and the station would go straight to the next record.
                    </Text>
                ) : undefined}
            </Stack>
        </Card>
    );
}

/**
 * One writer's turn, drawn the same way wherever it is read.
 *
 * Exported because an audition is this panel repeated down a playlist, and a second copy of the
 * lamp-plus-duration-plus-words row is exactly how the two would drift into disagreeing about what
 * a decline looks like.
 */
export function Attempt({ attempt }: { attempt: PersonaRehearsalAttempt }) {
    return (
        <Stack gap="xxs">
            <Group gap="xs" wrap="nowrap">
                <StatusLamp tone={toneFor(attempt.outcome)} label={attempt.writer} />
                <Text size="xs" c="dimmed" className="da-num">
                    {Math.round(attempt.durationMs)}ms
                </Text>
            </Group>
            {attempt.script ? (
                <Text size="sm">{attempt.script}</Text>
            ) : (
                <Text size="sm" c="dimmed">
                    {attempt.reason ?? 'nothing to say'}
                </Text>
            )}
        </Stack>
    );
}

/**
 * A writer's outcome as a tone.
 *
 * `declined` is `standby` rather than `fault` on the same argument the station badge makes about
 * waiting for a listener: a model that had nothing to say is the fall-through doing its job, and
 * drawing it as a fault would teach an operator to go looking for a break that never existed. Only
 * `failed` is something to go and fix.
 */
function toneFor(outcome: string): StatusTone {
    if (outcome === 'written') return 'ok';
    if (outcome === 'failed') return 'fault';
    return 'standby';
}
