import { Card, Group, Stack, Text } from '@mantine/core';
import type { PersonaRehearsal, PersonaRehearsalAttempt } from '@deadair/sdk';

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
 */
export function PersonaRehearsalPanel({ rehearsal }: { rehearsal: PersonaRehearsal }) {
    return (
        <Card withBorder mt="sm" padding="sm">
            <Stack gap="sm">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Eyebrow>Rehearsal</Eyebrow>
                    <Text size="xs" c="dimmed" ta="right">
                        between {rehearsal.previous} and {rehearsal.next}
                    </Text>
                </Group>

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

function Attempt({ attempt }: { attempt: PersonaRehearsalAttempt }) {
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
